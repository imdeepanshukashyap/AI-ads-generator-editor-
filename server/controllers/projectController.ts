import { Request, Response } from 'express'
import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary'
import { GenerateContentConfig, HarmBlockThreshold, HarmCategory } from '@google/genai'
import fs from 'fs';
import path from 'path';
import ai from '../configs/ai.js';
import axios from 'axios';
import { getAuth } from '@clerk/express';
import logger from '../configs/logger.js';

// Helper utilities for AI generation safety
const withTimeout = (promise: Promise<any>, ms: number) => {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), ms)
    );
    return Promise.race([promise, timeout]);
};

const isQuotaError = (err: any) => {
    const msg = err?.message?.toLowerCase() || '';
    return msg.includes('quota') || msg.includes('rate limit');
};

const loadImage = (path: string, mimeType: string) => {
    return {
        inlineData: {
            data: fs.readFileSync(path).toString('base64'),
            mimeType
        }
    }
}

// Advertisement Angles Configuration for 3-Image Bundle
const AD_ANGLES = [
    {
        name: "Hero Shot",
        camera: "Eye-level, front-facing, centered composition, product-focused, professional studio lighting"
    },
    {
        name: "Feature Detail",
        camera: "Macro side view, 45-degree angle, dramatic lighting showing product details and texture"
    },
    {
        name: "Lifestyle Action",
        camera: "Dynamic action shot, person actively using the product, natural movement, energetic composition"
    }
];

// Model Consistency Instruction for Bundle Generation
const CONSISTENCY_INSTRUCTION = `
CRITICAL: The person's facial features, clothing, and overall appearance must be 
IDENTICAL in all shots to maintain brand continuity. Same person, same outfit, 
same styling throughout all angles.
`;



/**
 * Create Project - Generates AI image from uploaded images
 * 
 * Flow: Validate inputs → Check credits → Upload to Cloudinary → 
 *       Generate AI image → Deduct credits → Return project ID
 */
export const createProject = async (req: Request, res: Response) => {
    const startTime = Date.now();
    let tempProjectId: string | undefined;
    const { userId } = getAuth(req);

    // Log request entry with context
    logger.info('[createProject] Request received', {
        userId,
        requestId: req.requestId,
        hasFiles: !!req.files,
        fileCount: (req.files as any)?.length || 0,
    });

    // Auth validation
    if (!userId) {
        logger.warn('[createProject] Unauthorized access attempt', { requestId: req.requestId });
        return res.status(401).json({ message: 'Unauthorized' });
    }

    let isCreditDeducted = false;

    const { name = 'New Project', aspectRatio, userPrompt, productName, productDescription, targetLength = 5, language = 'English' } = req.body;
    const images: any = req.files;

    // Input validation
    if (images.length < 2 || !productName) {
        logger.warn('[createProject] Validation failed - insufficient images or missing product name', {
            userId,
            imageCount: images.length,
            hasProductName: !!productName,
        });
        return res.status(400).json({ message: 'Please upload at least 2 images' });
    }

    logger.info('[createProject] Input validation passed', {
        userId,
        projectName: name,
        aspectRatio,
        productName,
        imageCount: images.length,
    });

    // Database query: Get or create user with proper error handling
    logger.debug('[createProject] Fetching user from database', { userId });
    let user = await prisma.user.findUnique({
        where: { id: userId }
    })

    // Handle race condition: if webhook hasn't created user yet, create them
    if (!user) {
        logger.warn('[createProject] User not found in database - auto-creating', { userId });
        try {
            user = await prisma.user.create({
                data: {
                    id: userId,
                    email: 'pending@clerk.sync', // Will be updated by webhook
                    name: 'Pending Sync',
                    image: '',
                    credits: 40
                }
            });
            logger.info('[createProject] User auto-created successfully', {
                userId,
                initialCredits: 40,
            });
        } catch (error: any) {
            logger.error('[createProject] Failed to auto-create user', {
                userId,
                error: error.message,
                stack: error.stack,
            });
            return res.status(500).json({ message: 'Failed to initialize user account. Please try again.' });
        }
    } else {
        logger.debug('[createProject] User found', { userId, credits: user.credits });
    }

    // Credit validation
    if (user.credits < 5) {
        logger.warn('[createProject] Insufficient credits', {
            userId,
            currentCredits: user.credits,
            requiredCredits: 5,
        });
        return res.status(403).json({ message: 'Insufficient credits. You need at least 5 credits to generate an image.' })
    }

    // Spam prevention: check if user already has a running generation
    logger.debug('[createProject] Checking for existing running generations', { userId });
    const existingRunning = await prisma.project.findFirst({
        where: { userId, isGenerating: true }
    });

    if (existingRunning) {
        logger.warn('[createProject] Generation already in progress - rejecting request', {
            userId,
            existingProjectId: existingRunning.id,
        });
        return res.status(429).json({ message: 'Generation already running' });
    }

    logger.info('[createProject] All validations passed - proceeding with generation', { userId });

    try {
        // External API call: Upload images to Cloudinary
        const cloudinaryStartTime = Date.now();
        logger.info('[createProject] Starting Cloudinary upload', {
            userId,
            imageCount: images.length,
        });

        let uploadedImages = await Promise.all(
            images.map(async (item: any) => {
                let result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' });
                return result.secure_url
            })
        )

        const cloudinaryDuration = Date.now() - cloudinaryStartTime;
        logger.info('[createProject] Cloudinary upload completed', {
            userId,
            imageCount: uploadedImages.length,
            duration: `${cloudinaryDuration}ms`,
        });

        // Database operation: Create project record
        logger.info('[createProject] Creating project record in database', {
            userId,
            projectName: name,
            aspectRatio,
        });

        const project = await prisma.project.create({
            data: {
                name,
                userId,
                productName,
                productDescription,
                userPrompt,
                aspectRatio,
                targetLength: parseInt(targetLength),
                language,
                uploadedImages,
                isGenerating: true
            }
        })

        tempProjectId = project.id;
        logger.info('[createProject] Project created successfully', {
            userId,
            projectId: project.id,
            model: 'gemini-3-pro-image-preview',
        });
        // Model Selection
        const model = 'gemini-3-pro-image-preview';

        // Safer generation config with lighter load
        const generationConfig: GenerateContentConfig = {
            maxOutputTokens: 2048, // Reduced from 8192
            temperature: 0.8,
            topP: 0.9,
            responseModalities: ['IMAGE'],
            imageConfig: {
                aspectRatio: aspectRatio || '9:16',
                imageSize: '512' // Reduced from 1K for preview model safety
            },
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.OFF,
                },
            ]
        }

        // Prepare images for AI model (convert to base64)
        logger.debug('[createProject] Converting images to base64 for AI model', { userId });
        const img1base64 = loadImage(images[0].path, images[0].mimetype);
        const img2base64 = loadImage(images[1].path, images[1].mimetype);

        const prompt = {
            text: `Combine the person and product into a realistic photo.
            Make the person naturally hold or use the product.
            Match lighting, shadows, scale and perspective.
            Make the person stand in professional studio lighting.
            Output ecommerce-quality photo realistic imagery.
            ${userPrompt}`
        }

        // External API call: Google AI image generation
        const aiStartTime = Date.now();
        logger.info('[createProject] Starting AI image generation', {
            userId,
            projectId: project.id,
            model,
            aspectRatio: generationConfig.imageConfig?.aspectRatio,
            imageSize: generationConfig.imageConfig?.imageSize,
        });

        // AI Call with timeout and single attempt only
        let response: any;
        try {
            response = await withTimeout(
                ai.models.generateContent({
                    model,
                    contents: [img1base64, img2base64, prompt],
                    config: generationConfig,
                }),
                60000 // 60 second timeout
            );
        } catch (err: any) {
            if (isQuotaError(err)) {
                logger.warn('[createProject] AI quota/rate limit error', {
                    userId,
                    projectId: project.id,
                    error: err.message,
                });
                throw new Error('Model quota reached — try later');
            }
            logger.error('[createProject] AI generation failed', {
                userId,
                projectId: project.id,
                error: err.message,
                stack: err.stack,
            });
            throw err;
        }

        const aiDuration = Date.now() - aiStartTime;
        logger.info('[createProject] AI generation completed', {
            userId,
            projectId: project.id,
            duration: `${aiDuration}ms`,
        });

        // Strict response validation
        logger.debug('[createProject] Validating AI response', { userId, projectId: project.id });
        const parts = response?.candidates?.[0]?.content?.parts || [];

        const imagePart = parts.find((p: any) => p.inlineData?.data);

        if (!imagePart) {
            logger.error('[createProject] No image returned from AI model', {
                userId,
                projectId: project.id,
                responseStructure: JSON.stringify(response?.candidates?.[0]?.content),
            });
            throw new Error('No image returned from model');
        }

        logger.info('[createProject] AI response validated successfully', {
            userId,
            projectId: project.id,
        });

        const finalBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
        const base64Image = `data:image/png;base64,${finalBuffer.toString('base64')}`

        // External API call: Upload generated image to Cloudinary
        logger.info('[createProject] Uploading generated image to Cloudinary', {
            userId,
            projectId: project.id,
        });
        const uploadResult = await cloudinary.uploader.upload(base64Image, { resource_type: 'image' });
        logger.info('[createProject] Generated image uploaded successfully', {
            userId,
            projectId: project.id,
            imageUrl: uploadResult.secure_url,
        });

        // Database operation: Deduct credits ONLY after success
        logger.info('[createProject] Deducting credits after successful generation', {
            userId,
            creditsToDeduct: 5,
        });
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 5 } }
        });
        isCreditDeducted = true;
        logger.info('[createProject] Credits deducted successfully', { userId });

        // Database operation: Update project with generated image
        await prisma.project.update({
            where: { id: project.id },
            data: {
                generatedImage: uploadResult.secure_url,
                isGenerating: false
            }
        })
        logger.info('[createProject] Project updated with generated image', {
            userId,
            projectId: project.id,
        });

        // Cleanup: Remove temporary uploaded files
        logger.debug('[createProject] Cleaning up temporary files', {
            userId,
            fileCount: images.length,
        });
        images.forEach((f: any) => fs.unlink(f.path, () => { }));

        const totalDuration = Date.now() - startTime;
        logger.info('[createProject] Request completed successfully', {
            userId,
            projectId: project.id,
            totalDuration: `${totalDuration}ms`,
        });

        res.json({ projectId: project.id })

    } catch (error: any) {
        // Error handling with rollback logic
        logger.error('[createProject] Request failed with error', {
            userId,
            projectId: tempProjectId,
            error: error.message,
            stack: error.stack,
            isCreditDeducted,
        });

        if (tempProjectId!) {
            // Database operation: Update project status with error
            logger.info('[createProject] Updating project with error status', {
                userId,
                projectId: tempProjectId,
            });
            await prisma.project.update({
                where: { id: tempProjectId },
                data: { isGenerating: false, error: error.message }
            })
        }

        if (isCreditDeducted) {
            // Database operation: Refund credits on failure
            logger.info('[createProject] Refunding credits due to error', {
                userId,
                creditsToRefund: 5,
            });
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            })
            logger.info('[createProject] Credits refunded successfully', { userId });
        }
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}


/**
 * Create Video - Generates AI video from generated image
 * 
 * Flow: Validate inputs → Check credits → Fetch project → 
 *       Generate AI video → Poll for completion → Upload to Cloudinary → Update project
 */
export const createVideo = async (req: Request, res: Response) => {
    const startTime = Date.now();
    const { userId } = getAuth(req)

    // Log request entry
    logger.info('[createVideo] Request received', {
        userId,
        requestId: req.requestId,
    });

    // Auth validation
    if (!userId) {
        logger.warn('[createVideo] Unauthorized access attempt', { requestId: req.requestId });
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const { projectId, selectedImage } = req.body;
    let isCreditDeducted = false;

    logger.info('[createVideo] Input validation passed', { userId, projectId });

    // Database query: Get or create user with proper error handling
    logger.debug('[createVideo] Fetching user from database', { userId });
    let user = await prisma.user.findUnique({
        where: { id: userId }
    })

    // Handle race condition: if webhook hasn't created user yet, create them
    if (!user) {
        logger.warn('[createVideo] User not found in database - auto-creating', { userId });
        try {
            user = await prisma.user.create({
                data: {
                    id: userId,
                    email: 'pending@clerk.sync', // Will be updated by webhook
                    name: 'Pending Sync',
                    image: '',
                    credits: 20
                }
            });
            logger.info('[createVideo] User auto-created successfully', {
                userId,
                initialCredits: 20,
            });
        } catch (error: any) {
            logger.error('[createVideo] Failed to auto-create user', {
                userId,
                error: error.message,
                stack: error.stack,
            });
            return res.status(500).json({ message: 'Failed to initialize user account. Please try again.' });
        }
    } else {
        logger.debug('[createVideo] User found', { userId, credits: user.credits });
    }

    // Credit validation
    if (user.credits < 10) {
        logger.warn('[createVideo] Insufficient credits', {
            userId,
            currentCredits: user.credits,
            requiredCredits: 10,
        });
        return res.status(403).json({ message: 'Insufficient credits. You need at least 10 credits to generate a video.' });
    }

    // Database operation: Deduct credits upfront (will refund on error)
    logger.info('[createVideo] Deducting credits upfront', {
        userId,
        creditsToDeduct: 10,
    });
    await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: 10 } }
    }).then(() => { isCreditDeducted = true });
    logger.info('[createVideo] Credits deducted successfully', { userId });

    try {
        // Database query: Fetch project with user details
        logger.info('[createVideo] Fetching project from database', { userId, projectId });
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId },
            include: { user: true }
        })

        if (!project) {
            logger.warn('[createVideo] Project not found', { userId, projectId });
            return res.status(404).json({ message: 'Project not found' });
        }

        logger.info('[createVideo] Project found', {
            userId,
            projectId,
            hasGeneratedImage: !!project.generatedImage,
            hasGeneratedVideo: !!project.generatedVideo,
        });

        // Video generation safety check
        if (project.isGenerating) {
            logger.warn('[createVideo] Generation already in progress', { userId, projectId });
            return res.status(429).json({ message: 'Generation in progress' });
        }

        if (project.generatedVideo) {
            logger.warn('[createVideo] Video already exists', { userId, projectId });
            return res.status(404).json({ message: 'Video already generated' });
        }

        // Database operation: Mark project as generating
        logger.info('[createVideo] Marking project as generating', { userId, projectId });
        await prisma.project.update({
            where: { id: projectId },
            data: { isGenerating: true }
        })

        // Language-specific narration instructions
        const languageInstructions: Record<string, string> = {
            'English': 'Narrate in clear, professional English.',
            'Hindi': 'Narrate in Hindi language (हिंदी में बोलें). Use natural, conversational Hindi.',
            'Hinglish': 'Narrate in Hinglish - a natural mix of Hindi and English commonly used in India. Use English words for technical/modern terms and Hindi for conversational flow. Example: "Yeh product bahut amazing hai, iska quality top-notch hai."',
            'Spanish': 'Narrate in Spanish language (español). Use clear, professional Spanish.',
            'French': 'Narrate in French language (français). Use clear, professional French.'
        };

        const languageInstruction = languageInstructions[project.language || 'English'] || languageInstructions['English'];

        const prompt = `
  ACT AS A PROFESSIONAL CINEMATOGRAPHER AND AD ADVERTISER.
  
  SCENE GOAL: Create a high-end, commercial-grade showcase video for ${project.productName}.
  PRODUCT CONTEXT: ${project.productDescription || 'Premium quality product'}.
  
  VISUAL STYLE:
  - 8k resolution, cinematic lighting, shallow depth of field (bokeh).
  - The person should interact with the product naturally and enthusiastically.
  - Use smooth camera movements (slow pan or slight zoom-in).
  - Lighting should be vibrant and professional ecommerce studio style.
  - Ensure the product is the focal point of the video.

  NARRATION LANGUAGE:
  ${languageInstruction}

  USER DIRECTION: ${project.userPrompt || 'Showcase the product effectively.'}
`;

        const model = 'veo-3.1-generate-preview'

        // Determine source image (prefer selected, then single, then bundle default)
        let sourceImage = selectedImage;

        // Validation: Ensure selected image belongs to project
        if (selectedImage) {
            const isValid = selectedImage === project.generatedImage || (project.generatedImages || []).includes(selectedImage);
            if (!isValid) sourceImage = null;
        }

        if (!sourceImage) {
            sourceImage = project.generatedImage || (project.generatedImages && project.generatedImages.length > 0 ? project.generatedImages[0] : null);
        }

        if (!sourceImage) {
            logger.error('[createVideo] Generated image not found', { userId, projectId });
            throw new Error('Generated image not found');
        }

        // External API call: Fetch generated image from Cloudinary
        logger.info('[createVideo] Fetching generated image from Cloudinary', {
            userId,
            projectId,
            imageUrl: sourceImage,
            isBundle: !!project.generatedImages && project.generatedImages.length > 0,
        });
        const image = await axios.get(sourceImage, { responseType: 'arraybuffer', })
        const imageBytes: any = Buffer.from(image.data)
        logger.debug('[createVideo] Image fetched and converted to buffer', { userId, projectId });

        // External API call: Google AI video generation
        const videoStartTime = Date.now();
        logger.info('[createVideo] Starting AI video generation', {
            userId,
            projectId,
            model,
            aspectRatio: project.aspectRatio,
        });

        let operation: any = await ai.models.generateVideos({
            model,
            prompt,
            image: {
                imageBytes: imageBytes.toString('base64'),
                mimeType: 'image/png',
            },
            config: {
                aspectRatio: project?.aspectRatio || '9:16',
                numberOfVideos: 1,
                resolution: '720p'
            }
        })

        logger.info('[createVideo] Video generation operation initiated', {
            userId,
            projectId,
            operationName: operation.name,
        });

        // Polling loop: Wait for video generation with timeout guard
        let attempts = 0;
        const maxAttempts = 30; // 5 minutes max (30 * 10 seconds)
        logger.info('[createVideo] Starting polling for video completion', {
            userId,
            projectId,
            maxAttempts,
            pollInterval: '10s',
        });

        while (!operation.done && attempts < maxAttempts) {
            logger.debug('[createVideo] Polling attempt', {
                userId,
                projectId,
                attempt: attempts + 1,
                maxAttempts,
            });
            await new Promise((resolve) => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({
                operation: operation,
            })
            attempts++;
        }

        if (!operation.done) {
            const timeoutDuration = Date.now() - videoStartTime;
            logger.error('[createVideo] Video generation timeout', {
                userId,
                projectId,
                attempts,
                duration: `${timeoutDuration}ms`,
            });
            throw new Error('Video generation timeout');
        }

        const videoDuration = Date.now() - videoStartTime;
        logger.info('[createVideo] Video generation completed', {
            userId,
            projectId,
            attempts,
            duration: `${videoDuration}ms`,
        });

        const filename = `${userId}-${Date.now()}.mp4`;
        const filePath = path.join('videos', filename)

        // File operation: Create videos directory if needed
        logger.debug('[createVideo] Creating videos directory', { userId, projectId });
        fs.mkdirSync('videos', { recursive: true })

        // Validation: Check if video was generated successfully
        if (!operation.response.generatedVideos) {
            const filterReason = operation.response.raiMediaFilteredReasons?.[0] || 'Unknown reason';
            logger.error('[createVideo] Video generation filtered by safety', {
                userId,
                projectId,
                reason: filterReason,
            });
            throw new Error(filterReason)
        }

        // External API call: Download video from Google AI
        logger.info('[createVideo] Downloading generated video', {
            userId,
            projectId,
            filePath,
        });
        await ai.files.download({
            file: operation.response.generatedVideos[0].video,
            downloadPath: filePath,
        })
        logger.info('[createVideo] Video downloaded successfully', { userId, projectId });

        // External API call: Upload video to Cloudinary
        logger.info('[createVideo] Uploading video to Cloudinary', { userId, projectId });
        const uploadResult = await cloudinary.uploader.upload(filePath, { resource_type: 'video' });
        logger.info('[createVideo] Video uploaded to Cloudinary', {
            userId,
            projectId,
            videoUrl: uploadResult.secure_url,
        });

        // Database operation: Update project with video URL
        await prisma.project.update({
            where: { id: project.id },
            data: {
                generatedVideo: uploadResult.secure_url,
                isGenerating: false
            }
        })
        logger.info('[createVideo] Project updated with generated video', {
            userId,
            projectId,
        });

        // Cleanup: Remove temporary video file
        logger.debug('[createVideo] Cleaning up temporary video file', { userId, projectId, filePath });
        fs.unlinkSync(filePath);

        const totalDuration = Date.now() - startTime;
        logger.info('[createVideo] Request completed successfully', {
            userId,
            projectId,
            totalDuration: `${totalDuration}ms`,
        });

        res.json({ message: 'Video generation completed', videoUrl: uploadResult.secure_url })

    } catch (error: any) {
        // Error handling with rollback logic
        logger.error('[createVideo] Request failed with error', {
            userId,
            projectId,
            error: error.message,
            stack: error.stack,
            isCreditDeducted,
        });

        // Database operation: Update project status with error
        logger.info('[createVideo] Updating project with error status', { userId, projectId });
        await prisma.project.update({
            where: { id: projectId, userId },
            data: { isGenerating: false, error: error.message }
        })

        if (isCreditDeducted) {
            // Database operation: Refund credits on failure
            logger.info('[createVideo] Refunding credits due to error', {
                userId,
                creditsToRefund: 10,
            });
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 10 } }
            })
            logger.info('[createVideo] Credits refunded successfully', { userId });
        }

        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}

/**
 * Get All Published Projects
 * 
 * Returns all projects marked as published for public viewing
 */
export const getAllPublishedProjects = async (req: Request, res: Response) => {
    logger.info('[getAllPublishedProjects] Request received', {
        requestId: req.requestId,
    });

    try {
        // Database query: Fetch all published projects
        logger.debug('[getAllPublishedProjects] Fetching published projects from database');
        const projects = await prisma.project.findMany({
            where: { isPublished: true }
        })

        logger.info('[getAllPublishedProjects] Published projects fetched successfully', {
            count: projects.length,
        });

        res.json({ projects })

    } catch (error: any) {
        logger.error('[getAllPublishedProjects] Request failed with error', {
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}

/**
 * Delete Project
 * 
 * Deletes a project owned by the authenticated user
 */
export const deleteProject = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    logger.info('[deleteProject] Request received', {
        userId,
        requestId: req.requestId,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[deleteProject] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { projectId } = req.params;
        logger.info('[deleteProject] Deleting project', { userId, projectId });

        // Database query: Find project to verify ownership
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId }
        })

        if (!project) {
            logger.warn('[deleteProject] Project not found or unauthorized', { userId, projectId });
            return res.status(404).json({ message: 'Project not found' });
        }

        // Database operation: Delete project
        await prisma.project.delete({
            where: { id: projectId }
        })

        logger.info('[deleteProject] Project deleted successfully', { userId, projectId });
        res.json({ message: 'Project deleted' });

    } catch (error: any) {
        logger.error('[deleteProject] Request failed with error', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}

/**
 * Create Project Bundle - Generates 3 AI images with different camera angles
 * 
 * Flow: Validate inputs → Check credits (15) → Upload to Cloudinary → 
 *       Generate 3 images in parallel → Deduct proportional credits → Return project ID
 */
export const createProjectBundle = async (req: Request, res: Response) => {
    const startTime = Date.now();
    let tempProjectId: string | undefined;
    const { userId } = getAuth(req);

    // Log request entry with context
    logger.info('[createProjectBundle] Request received', {
        userId,
        requestId: req.requestId,
        hasFiles: !!req.files,
        fileCount: (req.files as any)?.length || 0,
    });

    // Auth validation
    if (!userId) {
        logger.warn('[createProjectBundle] Unauthorized access attempt', { requestId: req.requestId });
        return res.status(401).json({ message: 'Unauthorized' });
    }

    let isCreditDeducted = false;
    let creditsDeducted = 0;

    const { name = 'New Project', aspectRatio, userPrompt, productName, productDescription, targetLength = 5, language = 'English' } = req.body;
    const images: any = req.files;

    // Input validation
    if (images.length < 2 || !productName) {
        logger.warn('[createProjectBundle] Validation failed - insufficient images or missing product name', {
            userId,
            imageCount: images.length,
            hasProductName: !!productName,
        });
        return res.status(400).json({ message: 'Please upload at least 2 images' });
    }

    logger.info('[createProjectBundle] Input validation passed', {
        userId,
        projectName: name,
        aspectRatio,
        productName,
        imageCount: images.length,
    });

    // Database query: Get or create user with proper error handling
    logger.debug('[createProjectBundle] Fetching user from database', { userId });
    let user = await prisma.user.findUnique({
        where: { id: userId }
    })

    // Handle race condition: if webhook hasn't created user yet, create them
    if (!user) {
        logger.warn('[createProjectBundle] User not found in database - auto-creating', { userId });
        try {
            user = await prisma.user.create({
                data: {
                    id: userId,
                    email: 'pending@clerk.sync', // Will be updated by webhook
                    name: 'Pending Sync',
                    image: '',
                    credits: 40
                }
            });
            logger.info('[createProjectBundle] User auto-created successfully', {
                userId,
                initialCredits: 40,
            });
        } catch (error: any) {
            logger.error('[createProjectBundle] Failed to auto-create user', {
                userId,
                error: error.message,
                stack: error.stack,
            });
            return res.status(500).json({ message: 'Failed to initialize user account. Please try again.' });
        }
    } else {
        logger.debug('[createProjectBundle] User found', { userId, credits: user.credits });
    }

    // Credit validation (15 credits required for 3-image bundle)
    if (user.credits < 15) {
        logger.warn('[createProjectBundle] Insufficient credits', {
            userId,
            currentCredits: user.credits,
            requiredCredits: 15,
        });
        return res.status(403).json({ message: 'Insufficient credits. You need at least 15 credits to generate a 3-image bundle.' })
    }

    // Spam prevention: check if user already has a running generation
    logger.debug('[createProjectBundle] Checking for existing running generations', { userId });
    const existingRunning = await prisma.project.findFirst({
        where: { userId, isGenerating: true }
    });

    if (existingRunning) {
        logger.warn('[createProjectBundle] Generation already in progress - rejecting request', {
            userId,
            existingProjectId: existingRunning.id,
        });
        return res.status(429).json({ message: 'Generation already running' });
    }

    logger.info('[createProjectBundle] All validations passed - proceeding with bundle generation', { userId });

    try {
        // External API call: Upload images to Cloudinary
        const cloudinaryStartTime = Date.now();
        logger.info('[createProjectBundle] Starting Cloudinary upload', {
            userId,
            imageCount: images.length,
        });

        let uploadedImages = await Promise.all(
            images.map(async (item: any) => {
                let result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' });
                return result.secure_url
            })
        )

        const cloudinaryDuration = Date.now() - cloudinaryStartTime;
        logger.info('[createProjectBundle] Cloudinary upload completed', {
            userId,
            imageCount: uploadedImages.length,
            duration: `${cloudinaryDuration}ms`,
        });

        // Database operation: Create project record
        logger.info('[createProjectBundle] Creating project record in database', {
            userId,
            projectName: name,
            aspectRatio,
        });

        const project = await prisma.project.create({
            data: {
                name,
                userId,
                productName,
                productDescription,
                userPrompt,
                aspectRatio,
                targetLength: parseInt(targetLength),
                language,
                uploadedImages,
                isGenerating: true
            }
        })

        tempProjectId = project.id;
        logger.info('[createProjectBundle] Project created successfully', {
            userId,
            projectId: project.id,
            model: 'gemini-3-pro-image-preview',
        });

        // Model Selection
        const model = 'gemini-3-pro-image-preview';

        // Generation config for bundle
        const generationConfig: GenerateContentConfig = {
            maxOutputTokens: 2048,
            temperature: 0.8,
            topP: 0.9,
            responseModalities: ['IMAGE'],
            imageConfig: {
                aspectRatio: aspectRatio || '9:16',
                imageSize: '512'
            },
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.OFF,
                },
            ]
        }

        // Prepare images for AI model (convert to base64)
        logger.debug('[createProjectBundle] Converting images to base64 for AI model', { userId });
        const img1base64 = loadImage(images[0].path, images[0].mimetype);
        const img2base64 = loadImage(images[1].path, images[1].mimetype);

        // Base prompt for all angles
        const basePrompt = `Combine the person and product into a realistic photo.
            Make the person naturally hold or use the product.
            Match lighting, shadows, scale and perspective.
            Make the person stand in professional studio lighting.
            Output ecommerce-quality photo realistic imagery.
            ${CONSISTENCY_INSTRUCTION}
            ${userPrompt}`;

        // External API call: Generate 3 images in parallel with different camera angles
        const aiStartTime = Date.now();
        logger.info('[createProjectBundle] Starting parallel AI image generation for 3 angles', {
            userId,
            projectId: project.id,
            model,
            angles: AD_ANGLES.map(a => a.name),
        });

        // Generate 3 images in parallel using Promise.allSettled for graceful degradation
        const generationPromises = AD_ANGLES.map(async (angle) => {
            const specificPrompt = {
                text: `${basePrompt}
                CAMERA ANGLE: ${angle.camera}
                SCENE TYPE: ${angle.name}`
            };

            try {
                logger.debug(`[createProjectBundle] Starting generation for ${angle.name}`, { userId, projectId: project.id });

                const response = await withTimeout(
                    ai.models.generateContent({
                        model,
                        contents: [img1base64, img2base64, specificPrompt],
                        config: generationConfig,
                    }),
                    90000 // 90 second timeout for bundle generation
                );

                logger.info(`[createProjectBundle] ${angle.name} generation completed`, { userId, projectId: project.id });
                return { status: 'fulfilled' as const, value: response, angle: angle.name };
            } catch (error: any) {
                logger.warn(`[createProjectBundle] ${angle.name} generation failed`, {
                    userId,
                    projectId: project.id,
                    error: error.message,
                    angle: angle.name,
                });
                return { status: 'rejected' as const, reason: error, angle: angle.name };
            }
        });

        const results = await Promise.allSettled(generationPromises);

        const aiDuration = Date.now() - aiStartTime;
        logger.info('[createProjectBundle] All parallel generations completed', {
            userId,
            projectId: project.id,
            duration: `${aiDuration}ms`,
        });

        // Process successful images
        const successfulImages: string[] = [];
        const failedAngles: string[] = [];

        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.status === 'fulfilled') {
                const response = result.value.value;
                const parts = response?.candidates?.[0]?.content?.parts || [];
                const imagePart = parts.find((p: any) => p.inlineData?.data);

                if (imagePart) {
                    try {
                        const finalBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
                        const base64Image = `data:image/png;base64,${finalBuffer.toString('base64')}`;

                        // Upload to Cloudinary
                        const uploadResult = await cloudinary.uploader.upload(base64Image, { resource_type: 'image' });
                        successfulImages.push(uploadResult.secure_url);
                        logger.info(`[createProjectBundle] ${result.value.angle} uploaded successfully`, {
                            userId,
                            projectId: project.id,
                            imageUrl: uploadResult.secure_url,
                        });
                    } catch (uploadError: any) {
                        logger.error(`[createProjectBundle] Failed to upload ${result.value.angle}`, {
                            userId,
                            projectId: project.id,
                            error: uploadError.message,
                        });
                        failedAngles.push(result.value.angle);
                    }
                } else {
                    logger.warn(`[createProjectBundle] No image data in ${result.value.angle} response`, {
                        userId,
                        projectId: project.id,
                    });
                    failedAngles.push(result.value.angle);
                }
            } else if (result.status === 'rejected') {
                failedAngles.push('Unknown angle');
            } else if (result.value.status === 'rejected') {
                failedAngles.push(result.value.angle);
            }
        }

        // Check if at least one image succeeded
        if (successfulImages.length === 0) {
            logger.error('[createProjectBundle] All image generations failed', {
                userId,
                projectId: project.id,
                failedAngles,
            });
            throw new Error('All image generations failed. Please try again.');
        }

        // Deduct proportional credits (5 per successful image)
        creditsDeducted = successfulImages.length * 5;
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: creditsDeducted } }
        });
        isCreditDeducted = true;

        logger.info('[createProjectBundle] Credits deducted successfully', {
            userId,
            creditsDeducted,
            successfulImages: successfulImages.length,
            failedImages: failedAngles.length,
        });

        // Update project with generated images
        await prisma.project.update({
            where: { id: project.id },
            data: {
                generatedImages: successfulImages,
                isGenerating: false
            }
        })
        logger.info('[createProjectBundle] Project updated with generated images', {
            userId,
            projectId: project.id,
            imageCount: successfulImages.length,
        });

        // Cleanup: Remove temporary uploaded files
        logger.debug('[createProjectBundle] Cleaning up temporary files', {
            userId,
            fileCount: images.length,
        });
        images.forEach((f: any) => fs.unlink(f.path, () => { }));

        const totalDuration = Date.now() - startTime;
        logger.info('[createProjectBundle] Request completed successfully', {
            userId,
            projectId: project.id,
            totalDuration: `${totalDuration}ms`,
            successfulImages: successfulImages.length,
            failedImages: failedAngles.length,
        });

        res.json({
            projectId: project.id,
            imagesGenerated: successfulImages.length,
            failedAngles: failedAngles.length > 0 ? failedAngles : undefined
        })

    } catch (error: any) {
        // Error handling with rollback logic
        logger.error('[createProjectBundle] Request failed with error', {
            userId,
            projectId: tempProjectId,
            error: error.message,
            stack: error.stack,
            isCreditDeducted,
            creditsDeducted,
        });

        if (tempProjectId!) {
            // Database operation: Update project status with error
            logger.info('[createProjectBundle] Updating project with error status', {
                userId,
                projectId: tempProjectId,
            });
            await prisma.project.update({
                where: { id: tempProjectId },
                data: { isGenerating: false, error: error.message }
            })
        }

        if (isCreditDeducted && creditsDeducted > 0) {
            // Database operation: Refund credits on failure
            logger.info('[createProjectBundle] Refunding credits due to error', {
                userId,
                creditsToRefund: creditsDeducted,
            });
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: creditsDeducted } }
            })
            logger.info('[createProjectBundle] Credits refunded successfully', { userId });
        }
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}
