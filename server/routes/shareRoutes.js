import express from "express";
import { accessShareLink, createShareLink, deleteShareLink, getUserShareLinks } from "../controllers/shareController.js";
import { protect } from "../middleware/auth.js";

const shareRouter = express.Router();

// Public Link Access (Anyone with the Link)
shareRouter.get("/access/:token", accessShareLink);

// Protected Share Management Endpoints
shareRouter.use(protect);

shareRouter.post("/", createShareLink);
shareRouter.get("/", getUserShareLinks);
shareRouter.delete("/:id", deleteShareLink);

export default shareRouter;