import { Response } from "express";
import { AuthRequest } from "../middlewares/authMiddlewware.js";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import { cloudinary } from "../config/cloudinary.js";
import { Generation } from "../models/Generation.js";
import { Post } from "../models/Post.js";

// Generate post
// POST /api/posts/generate
export const generatePost = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const { prompt, tone, generateImage } = req.body;

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            res.status(400).json({
                message:
                    "Gemini API Key is missing. Please add it to your server/.env file.",
            });
            return;
        }

        const ai = new GoogleGenAI({ apiKey });

        // -----------------------------
        // 1. Generate Social Media Text
        // -----------------------------

        const textResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `
Generate a social media post based on this prompt: "${prompt}".

Tone: ${tone}.

Include relevant hashtags.

Format the response as JSON with:
- "content"
- "imagePrompt"

The "imagePrompt" should be a highly descriptive visual prompt
for an image generator that complements the social media post.
`,
        });

        let content = "";
        let imagePrompt = prompt;

        try {
            const rawText = textResponse.text || "";

            // Extract JSON from Gemini response
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);

            const data = jsonMatch
                ? JSON.parse(jsonMatch[0])
                : {
                      content: rawText,
                      imagePrompt: prompt,
                  };

            content = data.content || rawText;
            imagePrompt = data.imagePrompt || prompt;
        } catch (e) {
            content = textResponse.text || "";
            imagePrompt = prompt;
        }

        // -----------------------------
        // 2. Generate AI Image
        // -----------------------------

        let mediaUrl = "";

        if (generateImage) {
            try {
                const pollinationsKey =
                    process.env.POLLINATIONS_API_KEY;

                if (!pollinationsKey) {
                    throw new Error(
                        "POLLINATIONS_API_KEY is missing from server/.env"
                    );
                }

                // Improve the image prompt
                const enhancedImagePrompt = `
Create a premium, high-quality social media image based on this concept:

${imagePrompt}

Visual requirements:
- Photorealistic
- Professional social-media aesthetic
- Strong visual storytelling
- Clear focal subject
- Cinematic natural lighting
- Realistic textures and materials
- Premium editorial photography
- Modern and visually clean composition
- Sharp focus on the main subject
- Subtle depth of field
- Professional color grading
- Visually engaging and polished
- Suitable for LinkedIn, Instagram and Twitter/X
- Square 1:1 composition
- 1024x1024 resolution

Do NOT include:
- Text
- Captions
- Letters
- Logos
- Watermarks
- UI elements
- Fake interfaces
- Distorted faces
- Distorted hands
- Extra fingers
- Duplicate objects
- Blurry subjects
- Low-quality artifacts
`;

                const encodedPrompt = encodeURIComponent(
                    enhancedImagePrompt
                );

               const imageUrl =
    `https://gen.pollinations.ai/image/${encodedPrompt}`;

                console.log(
                    "Generating image with Pollinations..."
                );

                // Get generated image
      

const imageResponse = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    headers: {
        Authorization: `Bearer ${pollinationsKey}`,
    },
    httpsAgent: new (await import("https")).Agent({
        rejectUnauthorized: false,
    }),
});
console.log(
    "Pollinations response:",
    imageResponse.headers["content-type"]
);

                // Upload image to Cloudinary
                const uploadResult = await new Promise<any>(
                    (resolve, reject) => {
                        const uploadStream =
                            cloudinary.uploader.upload_stream(
                                {
                                    folder: "ai-generations",
                                    resource_type: "image",
                                },
                                (error, result) => {
                                    if (error) {
                                        reject(error);
                                    } else {
                                        resolve(result);
                                    }
                                }
                            );

                        uploadStream.end(imageResponse.data);
                    }
                );

                mediaUrl = uploadResult.secure_url;

                console.log(
                    "Image generated and uploaded successfully."
                );
            } catch (err: any) {
                console.error(
                    "Image generation failed:",
                    err?.response?.data ||
                        err?.message ||
                        err
                );
            }
        }

        // -----------------------------
        // 3. Save Generation to DB
        // -----------------------------

        const generation = await Generation.create({
            user: req.user._id,
            prompt,
            content,
            mediaUrl,
            mediaType: mediaUrl ? "image" : undefined,
            tone,
        });

        res.json(generation);
    } catch (error: any) {
        console.error("Generate post error:", error);

        res.status(500).json({
            message: error?.message || "Server error",
        });
    }
};
export const getGenerations = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const generations = await Generation.find({
            user: req.user._id,
        }).sort({ createdAt: -1 });

        res.json(generations);
    } catch (error: any) {
        res.status(500).json({
            message: error?.message || "Server error",
        });
    }
};

// -----------------------------
// Get Posts
// GET /api/posts
// -----------------------------

export const getPosts = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const posts = await Post.find({
            user: req.user._id,
        });

        res.json(posts);
    } catch (error: any) {
        res.status(500).json({
            message: error?.message || "Server error",
        });
    }
};

// -----------------------------
// Schedule Post
// POST /api/posts
// -----------------------------

export const schedulePost = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const {
            content,
            platforms,
            scheduledFor,
            status,
        } = req.body;

        // Parse platforms if it comes as a stringified array
        // from FormData
        let parsedPlatforms = platforms;

        if (typeof platforms === "string") {
            try {
                parsedPlatforms = JSON.parse(platforms);
            } catch (e) {
                parsedPlatforms = platforms.split(",");
            }
        }

        let mediaUrl: string | undefined =
            req.body.mediaUrl;

        let mediaType:
            | "image"
            | "video"
            | undefined = req.body.mediaType;

        // If user uploads a file manually
        if (req.file) {
            const result = await new Promise<any>(
                (resolve, reject) => {
                    const stream =
                        cloudinary.uploader.upload_stream(
                            {
                                resource_type: "auto",
                                folder: "social-scheduler",
                            },
                            (error, result) => {
                                if (error) {
                                    reject(error);
                                } else {
                                    resolve(result);
                                }
                            }
                        );

                    stream.end(req.file!.buffer);
                }
            );

            mediaUrl = result.secure_url;

            mediaType =
                result.resource_type === "video"
                    ? "video"
                    : "image";
        }

        const post = await Post.create({
            user: req.user._id,
            content,
            platforms: parsedPlatforms,
            mediaUrl,
            mediaType,
            scheduledFor,
            status,
        });

        res.status(201).json(post);
    } catch (error: any) {
        res.status(500).json({
            message: error?.message || "Server error",
        });
    }
};