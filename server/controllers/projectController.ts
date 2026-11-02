import { Request, Response } from 'express'
import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary'
import { GenerateContentConfig, HarmBlockThreshold, HarmCategory } from '@google/genai'
import fs from 'fs';
import { getAuth } from '@clerk/express';
import logger from '../configs/logger.js';
import { cleanupGoogleDirectory, generateGoogleImages, generateGoogleVideo } from '../services/googleAiService.js';

// Helper utilities for AI generation safety
const withTimeout = (promise: Promise<any>, ms: number) => {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), ms)
    );
    return Promise.race([promise, timeout]);
};

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

    const { name = 'New Project', aspectRatio, userPrompt, productName, productDescription, targetLength = 5, language = 'English', modelLibraryId } = req.body;
    const images: any = req.files || [];

    // Input validation
    if ((images.length < (modelLibraryId ? 1 : 2)) || !productName) {
        logger.warn('[createProject] Validation failed - insufficient images or missing product name', {
            userId,
            imageCount: images.length,
            hasProductName: !!productName,
        });
        return res.status(400).json({ message: 'Please upload at least 2 images' });
    }

    let libraryModelImage: string | null = null;
    if (modelLibraryId) {
        const model = await prisma.modelLibraryEntry.findFirst({ where: { id: modelLibraryId, isPublished: true }, select: { imageUrl: true } });
        if (!model) return res.status(400).json({ message: 'The selected AI model is unavailable. Please choose another model.' });
        libraryModelImage = model.imageUrl;
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
    // Auto-reset locks older than 5 minutes (they are stale from a crash/timeout)
    logger.debug('[createProject] Checking for existing running generations', { userId });
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.project.updateMany({
        where: { userId, isGenerating: true, updatedAt: { lt: fiveMinutesAgo } },
        data: { isGenerating: false, error: 'Generation timed out (auto-reset)' }
    });

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
        if (libraryModelImage) uploadedImages = [...uploadedImages, libraryModelImage];

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
            model: process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
        });

        // Prepare prompt for Google Gemini image generation
        const promptText = `High-end commercial advertisement photo. Product: ${productName}. ${productDescription ? `Product Details: ${productDescription}.` : ''} Combine the person and product into a realistic photo. Make the person naturally hold or use the product. Professional studio lighting, match shadows, scale and perspective. Output ecommerce-quality photorealistic imagery. ${userPrompt || ''}`.trim();

        // External API call: Google Gemini image generation
        const aiStartTime = Date.now();
        logger.info('[createProject] Starting Google AI image generation', {
            userId,
            projectId: project.id,
            model: 'default',
        });

        let imageOutput: { paths: string[]; directory: string };
        try {
            imageOutput = await generateGoogleImages(
                {
                    prompt: promptText,
                    imageUrls: uploadedImages,
                    imageCount: 1,
                },
            );
        } catch (err: any) {
            logger.error('[createProject] Google AI image generation failed', {
                userId,
                projectId: project.id,
                error: err.message,
                stack: err.stack,
            });
            throw err;
        }

        const aiDuration = Date.now() - aiStartTime;
        logger.info('[createProject] Google AI image generation completed', {
            userId,
            projectId: project.id,
            duration: `${aiDuration}ms`,
        });

        // External API call: Upload generated image to Cloudinary
        logger.info('[createProject] Uploading generated image to Cloudinary', {
            userId,
            projectId: project.id,
        });
        const uploadResult = await cloudinary.uploader.upload(imageOutput.paths[0], { resource_type: 'image' });
        await cleanupGoogleDirectory(imageOutput.directory);
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
                generatedImages: [uploadResult.secure_url],
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

        // External API call: Google Veo image-to-video generation
        const videoStartTime = Date.now();
        logger.info('[createVideo] Starting Google AI video generation', {
            userId,
            projectId,
            aspectRatio: project.aspectRatio,
        });

        const videoOutput = await generateGoogleVideo({
            imageUrl: sourceImage,
            prompt,
            durationSeconds: Math.max(4, Math.min(project.targetLength || 5, 8)),
            aspectRatio: project.aspectRatio,
        });
        const videoDuration = Date.now() - videoStartTime;
        logger.info('[createVideo] Google AI video generation completed', {
            userId,
            projectId,
            duration: `${videoDuration}ms`,
        });

        // External API call: Upload video to Cloudinary
        logger.info('[createVideo] Uploading video to Cloudinary', { userId, projectId });
        const uploadResult = await cloudinary.uploader.upload(videoOutput.path, { resource_type: 'video' });
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

        // Cleanup: Remove temporary Google output
        await cleanupGoogleDirectory(videoOutput.directory);

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

    const { name = 'New Project', aspectRatio, userPrompt, productName, productDescription, targetLength = 5, language = 'English', modelLibraryId } = req.body;
    const images: any = req.files || [];

    // Input validation
    if ((images.length < (modelLibraryId ? 1 : 2)) || !productName) {
        logger.warn('[createProjectBundle] Validation failed - insufficient images or missing product name', {
            userId,
            imageCount: images.length,
            hasProductName: !!productName,
        });
        return res.status(400).json({ message: 'Please upload at least 2 images' });
    }

    let libraryModelImage: string | null = null;
    if (modelLibraryId) {
        const model = await prisma.modelLibraryEntry.findFirst({ where: { id: modelLibraryId, isPublished: true }, select: { imageUrl: true } });
        if (!model) return res.status(400).json({ message: 'The selected AI model is unavailable. Please choose another model.' });
        libraryModelImage = model.imageUrl;
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
    // Auto-reset locks older than 2 minutes (stale from crash/timeout)
    logger.debug('[createProjectBundle] Checking for existing running generations', { userId });
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await prisma.project.updateMany({
        where: { userId, isGenerating: true, updatedAt: { lt: twoMinutesAgo } },
        data: { isGenerating: false, error: 'Generation timed out (auto-reset)' }
    });

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
        if (libraryModelImage) uploadedImages = [...uploadedImages, libraryModelImage];

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
            model: 'gpt-image-2',
        });

        // Base prompt for all angles
        const basePrompt = `High-end commercial advertisement photo. Product: ${productName}. ${productDescription ? `Product Details: ${productDescription}.` : ''} Combine the person and product into a realistic photo. Make the person naturally hold or use the product. Professional studio lighting, match shadows, scale and perspective. Output ecommerce-quality photorealistic imagery. ${CONSISTENCY_INSTRUCTION} ${userPrompt || ''}`.trim();

        // External API call: Generate 3 images in parallel with different camera angles via Google Gemini
        const aiStartTime = Date.now();
        logger.info('[createProjectBundle] Starting parallel Google AI image generation for 3 angles', {
            userId,
            projectId: project.id,
            model: process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
            angles: AD_ANGLES.map(a => a.name),
        });

        // Generate 3 images in parallel using Promise.allSettled for graceful degradation
        const generationPromises = AD_ANGLES.map(async (angle) => {
            const specificPrompt = `${basePrompt} CAMERA ANGLE: ${angle.camera}. SCENE TYPE: ${angle.name}.`;

            try {
                logger.debug(`[createProjectBundle] Starting Google AI generation for ${angle.name}`, { userId, projectId: project.id });

                const imageOutput = await generateGoogleImages(
                    {
                        prompt: specificPrompt,
                        imageUrls: uploadedImages,
                        imageCount: 1,
                    },
                );

                const rawImagePath = imageOutput.paths[0];

                logger.info(`[createProjectBundle] ${angle.name} generation completed from Google AI`, { userId, projectId: project.id });
                return { status: 'fulfilled' as const, value: { path: rawImagePath, directory: imageOutput.directory }, angle: angle.name };
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
                const imageOutput = result.value.value;
                try {
                    // Upload to Cloudinary for permanent storage
                    const uploadResult = await cloudinary.uploader.upload(imageOutput.path, { resource_type: 'image' });
                    await cleanupGoogleDirectory(imageOutput.directory);
                    successfulImages.push(uploadResult.secure_url);
                    logger.info(`[createProjectBundle] ${result.value.angle} uploaded to Cloudinary successfully`, {
                        userId,
                        projectId: project.id,
                        imageUrl: uploadResult.secure_url,
                    });
                } catch (uploadError: any) {
                    logger.error(`[createProjectBundle] Failed to upload ${result.value.angle} to Cloudinary`, {
                        userId,
                        projectId: project.id,
                        error: uploadError.message,
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
                generatedImage: successfulImages[0],
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

/**
 * Reset Generation Lock
 *
 * Clears any stuck isGenerating=true flags for the current user.
 * Use this when "Generation already running" blocks new requests after a crash/timeout.
 */
export const resetGeneration = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const result = await prisma.project.updateMany({
            where: { userId, isGenerating: true },
            data: { isGenerating: false, error: 'Generation reset by user' }
        });

        logger.info('[resetGeneration] Cleared stuck generation locks', {
            userId,
            count: result.count,
        });

        res.json({ message: `Cleared ${result.count} stuck generation(s). You can now generate again.` });
    } catch (error: any) {
        logger.error('[resetGeneration] Failed to reset generation locks', {
            userId,
            error: error.message,
        });
        res.status(500).json({ message: error.message });
    }
}
