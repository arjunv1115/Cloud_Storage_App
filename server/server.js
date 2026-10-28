import express from "express";
import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import { initDB } from "./config/db.js";
import authRouter from "./routes/authRoutes.js";
import folderRouter from "./routes/folderRoutes.js";
import fileRouter from "./routes/fileRoutes.js";
import trashRouter from "./routes/trashRoutes.js";
import shareRouter from "./routes/shareRoutes.js";

const app = express();

// CORS Configuration
const allowedOrigins = (process.env.ORIGINS || "http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error("Origin not allowed by CORS")); }, credentials: true }));

// Middlewares
app.use(cookieParser());
app.use(express.json({limit: "100mb"}));

// Root API
app.get("/", (_req, res) => res.send("Server is Running"));

// App API Routes
app.use("/api/auth", authRouter);
app.use("/api/folders", folderRouter);
app.use("/api/files", fileRouter);
app.use("/api/trash", trashRouter);
app.use("/api/shares", shareRouter);

// Error Handling Middleware
app.use((err, _req, res, _next)=>{
    res.status(err.status || 500).json({error: err.message || "Something went Wrong!"});
})

const port = process.env.PORT || 5000;

// Initialize DB Connection then Start Server
initDB().then(()=>{
    app.listen(port, ()=>{
    console.log(`Server Running at http://localhost:${port}`);
    })
})

