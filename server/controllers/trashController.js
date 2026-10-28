import { sql } from "../config/db.js";
import { emptyTrashHierarchy } from "../services/storageService.js";


// Get all Trashed Files and Folders for User
// GET /api/trash
export const getTrashItems = async (req, res) => {
    try {
        const [files, folders] = await Promise.all([
            sql`
            SELECT * FROM files
            WHERE owner_id = ${req.user.id} AND is_trashed = true
            ORDER BY trashed_at DESC
            `,
            sql`
            SELECT * FROM folders
            WHERE owner_id = ${req.user.id} AND is_trashed = true
            ORDER BY trashed_at DESC
            `
        ])
        return res.status(200).json({ files, folders });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }    
}

// Empty User Trash (Permanently Delete all Trashed Items)
// POST /api/trash/empty
export const emptyTrash = async (req, res) => {
    try {
        await emptyTrashHierarchy(req.user.id);
        return res.status(200).json({ message: "Trash Emptied Successfully." });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}