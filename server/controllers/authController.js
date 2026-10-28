import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "../config/db.js";


// Generate JWT Access Token and Attaches it to Response as HTTP-Only Cookie
export const sendTokenResponse = (res, userId, statusCode = 200, extraData = {})=>{
    const token = jwt.sign({id: userId}, process.env.JWT_SECRET, {expiresIn: "7d"});

    const isProduction = process.env.NODE_ENV === "production"

    res.cookie("token", token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Days
    })

    res.status(statusCode).json({token, ...extraData});
}

// Register New User
// POST /api/auth/register
export const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if(!name?.trim() || !email?.trim() || !password){
            return res.status(400).json({error: "Name, Email and Password are Required."});
        }

        const normalizedEmail = email.toLowerCase().trim();

        const [existing] = await sql`SELECT id FROM users WHERE email = ${normalizedEmail}`;

        if(existing){
            return res.status(400).json({error: "User with this Email Already Exists."});
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const storageLimit = Number(process.env.MAX_STORAGE_PER_USER || 1073741824);

        const [user] = await sql`INSERT INTO users (name, email, password, storage_limit)
        VALUES (${name.trim()}, ${normalizedEmail}, ${hashedPassword}, ${storageLimit})
        RETURNING id, name, email, storage_used, storage_limit, created_at, updated_at`;

        return sendTokenResponse(res, user.id, 200, {user});
    } catch (error) {
        return res.status(500).json({error: error.message});
    }
}

// Login User
// POST /api/auth/login
export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        if(!email?.trim() || !password){
            return res.status(400).json({error: "Email and Password are Required."});
        }

        const normalizedEmail = email.toLowerCase().trim();

        const [user] = await sql`SELECT id, name, email, password, storage_used, storage_limit, created_at, updated_at FROM users WHERE email = ${normalizedEmail}`;

        if(!user){
            return res.status(401).json({error: "Invalid Email or Password."});
        }

        const isMatch = await bcrypt.compare(password, user.password)
        if(!isMatch){
            return res.status(401).json({error: "Invalid Email or Password."});
        }

        delete user.password;

        return sendTokenResponse(res, user.id, 200, {user});
    } catch (error) {
        return res.status(500).json({error: error.message});
    }
}

// Logout User & Clear Cookie
// POST /api/auth/logout
export const logoutUser = async (_req, res) => {
    try {
        const isProduction = process.env.NODE_ENV === "production";
        res.clearCookie("token", {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? "none" : "lax"
        })

        return res.status(200).json({message: "Logged Out Successfully."});
    } catch (error) {
        return res.status(500).json({error: error.message});
    }
}

// Get Current User Profile & Storage Info
// GET /api/auth/me
export const getMe = async (req, res) => {
    try {
        // req.user is already Loaded by Protect Middleware
        return res.status(200).json({user: req.user});
    } catch (error) {
        return res.status(500).json({error: error.message});
    }
}