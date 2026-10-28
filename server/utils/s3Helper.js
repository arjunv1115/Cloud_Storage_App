import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { BUCKET_NAME, client } from "../config/s3.js"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


// Upload File to Neon Object Storage
export const uploadToStorage = async (fileBuffer, key, mimeType) => {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType
    });
    await client.send(command);
    return {s3Key: key};
}

// Get Presigned Download/Preview URL for a File (Valid for 10 hour)
export const getSignedFileUrl = async (key) => {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key
    });
    return await getSignedUrl(client, command, {expiresIn: 36000});
}

// Permanently Delete an Object and its Versions from Neon Object Storage
export const deleteFromStorage = async (key) => {
    if(!key) return;
    try {
        const {Versions = [], DeleteMarkers = []} = await client.send(
            new ListObjectVersionsCommand({Bucket: BUCKET_NAME, Prefix: key})
        );

        const Objects = [...Versions, ...DeleteMarkers].filter((v)=> v.Key === key).map(({Key, VersionId})=>({Key, VersionId}));

        if (Objects.length > 0){
            await client.send(new DeleteObjectCommand({Bucket: BUCKET_NAME, Delete: { Objects }}));
        } else {
            await client.send(new DeleteObjectCommand({Bucket: BUCKET_NAME, Key: key}));
        }
    } catch (err) {
        try {
            await client.send(new DeleteObjectCommand({Bucket: BUCKET_NAME, Key: key}));
        } catch (fallbackErr) {
            console.error("[Storage Delete Error]:", fallbackErr.message);
            throw fallbackErr;
        }
    }
}

// Batch Permanently Delete Multiple Keys from Neon Object Storage
export const deleteMultipleFromStorage = async (keys) => {
    if(!keys?.length) return;
    await Promise.all(keys.map(deleteFromStorage))
}