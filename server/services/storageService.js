import { sql } from "../config/db.js"
import { deleteFromStorage, deleteMultipleFromStorage } from "../utils/s3Helper.js";

// Get all Descendant Folder IDs for a given Folder Including the Root Folder ID itself.
export const getFolderHierarchyIds = async (folderId, ownerId) => {
    const descendants = await sql`
    SELECT id FROM folders
    WHERE ${folderId} = ANY(path::text[]) AND owner_id = ${ownerId}`;
    return [folderId, ...descendants.map((f)=> f.id)]
}

// Adjust User Storage Quota
export const adjustUserStorage = async (userId, deltaBytes) => {
    const [user] = await sql`
    UPDATE users
    SET storage_used = GREATEST(0, storage_used + ${deltaBytes}), updated_at = NOW() WHERE id = ${userId} RETURNING storage_used
    `;

    return user ? Number(user.storage_used) : null;
}

// Remove Share Links Associated with Given Resource IDs.
export const cleanupShareLinks = async (fileIds = [], folderIds = []) => {
    if(fileIds.length === 0 && folderIds.length === 0) return;

    const allIds = [...fileIds, ...folderIds];
    await sql`DELETE FROM share_links WHERE resource_id = ANY(${allIds}::uuid[])`
}

// Soft Delete a Folder and all its Contents (Recursive Subfolders & Files).
export const softDeletFolderHierarchy = async (folderId, ownerId) => {
    const allFolderIds = await getFolderHierarchyIds(folderId, ownerId)
    const now = new Date();

    // Get all the File IDs in Hierarchy for Share Link Cleanup
    const files = await sql`
    SELECT id FROM files
    WHERE folder_id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}
    AND is_trashed = false`;

    const fileIds = files.map((f)=> f.id)

    await Promise.all([
        sql`
        UPDATE folders 
        SET is_trashed = true, trashed_at = ${now}, updated_at = NOW()
        WHERE id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}
        `,
        fileIds.length > 0 ? sql`
        UPDATE files 
        SET is_trashed = true, trashed_at = ${now}, updated_at = NOW()
        WHERE id = ANY(${fileIds}::uuid[]) AND owner_id = ${ownerId}
        `
        : Promise.resolve(), 
        cleanupShareLinks(fileIds, allFolderIds)
    ])
}

// Restore a Folder and all its Contents (Recursive Subfolders & Files).
export const restoreFolderHierarchy = async (folderId, ownerId) => {
    const allFolderIds = await getFolderHierarchyIds(folderId, ownerId);

    await Promise.all([
        sql`
        UPDATE folders
        SET is_trashed = false, trashed_at = NULL, updated_at = NOW()
        WHERE id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}
        `,
        sql`
        UPDATE files
        SET is_trashed = false, trashed_at = NULL, updated_at = NOW()
        WHERE folder_id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}
        `
    ])
}

// Permanently Delete a Folder and all its Contents (Recursive Subfolders & Files)
export const permanentDeleteFolderHierarchy = async (folderId, ownerId) => {
    const allFolderIds = await getFolderHierarchyIds(folderId, ownerId);

    const files = await sql`
    SELECT id, s3_key, size FROM files
    WHERE folder_id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}
    `

    const s3Keys = files.map((f)=>f.s3_key);
    const fileIds = files.map((f)=>f.id);
    const totalFreedSize = files.reduce((acc, f)=> acc + Number(f.size), 0);

    await Promise.all([
        s3Keys.length > 0 ? deleteMultipleFromStorage(s3Keys) : Promise.resolve(),
        cleanupShareLinks(fileIds, allFolderIds),
        fileIds.length > 0 ? sql`DELETE FROM files WHERE id = ANY(${fileIds}::uuid[])` : Promise.resolve(),
        sql`DELETE FROM folders WHERE id = ANY(${allFolderIds}::uuid[])`
    ])

    if(totalFreedSize > 0){
       await adjustUserStorage(ownerId, -totalFreedSize);
    }
}

// Permanently Delete a Single File
export const permanentDeleteFileRecord = async (file, ownerId) => {
    await Promise.all([deleteFromStorage(file.s3_key), cleanupShareLinks([file.id], []), sql`DELETE FROM files WHERE id = ${file.id}`])
    await adjustUserStorage(ownerId, -Number(file.size))
}

// Permanently Empty User's Trash Bin.
export const emptyTrashHierarchy = async (ownerId) => {
    const [trashedFiles, trashedFolders] = await Promise.all([
        sql`SELECT id, s3_key, size FROM files WHERE owner_id = ${ownerId} AND is_trashed = true`,
        sql`SELECT id FROM folders WHERE owner_id = ${ownerId} AND is_trashed = true`,
    ]);

    const s3Keys = trashedFiles.map((f)=> f.s3_key);
    const totalFreedBytes = trashedFiles.reduce((acc, f)=> acc + Number(f.size), 0);
    const trashedFileIds = trashedFiles.map((f)=>f.id);
    const trashedFolderIds = trashedFolders.map((f)=>f.id);

    await Promise.all([
        s3Keys.length > 0 ? deleteMultipleFromStorage(s3Keys) : Promise.resolve(),
        cleanupShareLinks(trashedFileIds, trashedFolderIds),
        sql`DELETE FROM files WHERE owner_id = ${ownerId} AND is_trashed = true`,
        sql`DELETE FROM folders WHERE owner_id = ${ownerId} AND is_trashed = true`,
    ]);

    if(totalFreedBytes > 0){
        await adjustUserStorage(ownerId, -totalFreedBytes)
    }
}