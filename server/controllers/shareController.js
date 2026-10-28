import { sql } from "../config/db.js";
import crypto from "crypto";
import { getSignedFileUrl } from "../utils/s3Helper.js"

// Create or Retrieve Public Share Link for File or Folder
// POST /api/shares
export const createShareLink = async (req, res) => {
    try {
        const resourceType = req.body.resource_type ?? req.body.resourceType;
        const resourceId = req.body.resource_id ?? req.body.resourceId;
        const { permission = "download", expires_at, expiresAt } = req.body;
        if (!["download", "view"].includes(permission)) {
            return res.status(400).json({ error: "Permission must be 'view' or 'download'." });
        }

        const targetExpiresAt = expires_at ?? expiresAt;

        if (!resourceId || !["file", "folder"].includes(resourceType)) {
            return res.status(400).json({ error: "Resource Type must be File or Folder." });
        }

        // Verify Resource Exists and Belongs to User
        const [resource] = 
        resourceType === "file"
        ? await sql`
        SELECT id FROM files
        WHERE id = ${resourceId} AND owner_id = ${req.user.id} AND is_trashed = false`
        :
        await sql`
        SELECT id FROM folders
        WHERE id = ${resourceId} AND owner_id = ${req.user.id} AND is_trashed = false
        `;

        if(!resource){
            return res.status(404).json({ error: `${resourceType} not Found.` });
        }

        // Check for an Existing Share Link for this Resource
        const [existing] = await sql`
        SELECT * FROM share_links
        WHERE resource_type = ${resourceType} 
        AND resource_id = ${resource.id} 
        AND owner_id = ${req.user.id}`;

        // If Expired, Remove It
        if(existing && existing.expires_at && new Date() > new Date(existing.expires_at)){
            await sql`DELETE FROM share_links WHERE id = ${existing.id}`;
        } else if(existing){
            return res.status(200).json({ share_link: existing, is_existing: true });
        }

        const token = crypto.randomBytes(16).toString("hex");
        const [shareLink] = await sql`
        INSERT INTO share_links (token, resource_type, resource_id, owner_id, permission, expires_at)
        VALUES (${token}, ${resourceType}, ${resource.id}, ${req.user.id}, ${permission}, ${targetExpiresAt ? new Date(targetExpiresAt) : null})
        RETURNING *
        `;

        return res.status(201).json({ share_link: shareLink, is_existing: false });
        
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Get User's Share Links with Single-Query Resource Resolution
// GET /api/shares
export const getUserShareLinks = async (req, res) => {
    try {
        const activeShareLinks = await sql`
            SELECT sl.*,
            CASE
                WHEN sl.resource_type = 'file' THEN json_build_object('id', f.id, 'name', f.name, 'mime_type', f.mime_type, 'size', f.size)
                WHEN sl.resource_type = 'folder' THEN json_build_object('id', fo.id, 'name', fo.name)
            END AS resource
        FROM share_links sl
        LEFT JOIN files f ON sl.resource_type = 'file' AND f.id = sl.resource_id AND f.is_trashed = false
        LEFT JOIN folders pf ON f.folder_id = pf.id
        LEFT JOIN folders fo ON sl.resource_type = 'folder' AND fo.id = sl.resource_id AND fo.is_trashed = false
        WHERE sl.owner_id = ${req.user.id}
        AND (
            (sl.resource_type = 'file' AND f.id IS NOT NULL AND (f.folder_id IS NULL OR pf.is_trashed = false))
            OR
            (sl.resource_type = 'folder' AND fo.id IS NOT NULL)
        )
        ORDER BY sl.created_at DESC
        `;

        return res.status(200).json({ share_links: activeShareLinks });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Access Shared Item by Token (Public Link for Anyone)
// GET /api/shares/access/:token
export const accessShareLink = async (req, res) => {
    try {
        const { token } = req.params;

        const [shareLink] = await sql`SELECT * FROM share_links WHERE token = ${token}`;

        if(!shareLink){
            return res.status(404).json({ error: "Share Link not Found or has been Revoked." });
        }

        // Check Expiration
        if(shareLink.expires_at && new Date() > new Date(shareLink.expires_at)){
            return res.status(410).json({ error: "This Share Link has Expired." });
        }

        // Increment Access Count Automatically
        await sql`UPDATE share_links SET access_count = access_count + 1 WHERE id = ${shareLink.id}`;

        // Fetch Owner Info
        const [owner] = await sql`SELECT id, name, email FROM users WHERE id = ${shareLink.owner_id}`;

        if(shareLink.resource_type === "file"){
            const [file] = await sql`SELECT * FROM files WHERE id = ${shareLink.resource_id}`;
            if(!file || file.is_trashed){
                return res.status(404).json({ error: "File is No Longer Available." });
            }

            if(file.folder_id){
                const [parentFolder] = await sql`SELECT is_trashed FROM folders WHERE id = ${file.folder_id}`;
                if(!parentFolder || parentFolder.is_trashed){
                    return res.status(404).json({ error: "File is No Longer Available." });
                }
            }

            const downloadUrl = await getSignedFileUrl(file.s3_key);
            return res.status(200).json({
                resource_type: "file",
                file,
                url: downloadUrl,
                permission: shareLink.permission,
                owner,
            })
        }
        
        // Folder Resource
        const [folder] = await sql`SELECT * FROM folders WHERE id = ${shareLink.resource_id}`;
        if (!folder || folder.is_trashed){
            return res.status(404).json({ error: "Folder is No Longer Available." });
        }

        const [subfolders, files] = await Promise.all([
            sql`SELECT id, name, parent_id, created_at FROM folders WHERE parent_id = ${folder.id} AND is_trashed = false`,
            sql`SELECT * FROM files WHERE folder_id = ${folder.id} AND is_trashed = false`,
        ]);

        const filesWithUrls = await Promise.all(
            files.map(async (f)=>({
                ...f,
                url: await getSignedFileUrl(f.s3_key)
            }))
        );

        return res.status(200).json({
            resource_type: "folder",
            folder,
            subfolders,
            files: filesWithUrls,
            permission: shareLink.permission,
            owner,
        })
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Revoke / Delete Share Link
// DELETE /api/shares/:id
export const deleteShareLink = async (req, res) => {
    try {
        const [shareLink] = await sql`
        DELETE FROM share_links
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id}
        RETURNING id`;

        if(!shareLink){
            return res.status(404).json({ error: "Share Link not Found." });
        }

        return res.status(200).json({ message: "Share Link Revoked Successfully." });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}