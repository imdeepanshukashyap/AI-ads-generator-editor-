import { Request, Response } from 'express'
import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
import { getAuth } from '@clerk/express';
import logger from '../configs/logger.js';

/**
 * Get User Credits
 * 
 * Returns the current credit balance for the authenticated user
 */
export const getUserCredits = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    logger.info('[getUserCredits] Request received', {
        userId,
        requestId: req.requestId,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[getUserCredits] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Database query: Get or create user with proper error handling
        logger.debug('[getUserCredits] Fetching user from database', { userId });
        let user = await prisma.user.findUnique({
            where: { id: userId }
        })

        // Handle race condition: if webhook hasn't created user yet, create them
        if (!user) {
            logger.warn('[getUserCredits] User not found - auto-creating', { userId });
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
                logger.info('[getUserCredits] User auto-created successfully', {
                    userId,
                    initialCredits: 20,
                });
            } catch (error: any) {
                logger.error('[getUserCredits] Failed to auto-create user', {
                    userId,
                    error: error.message,
                    stack: error.stack,
                });
                return res.status(500).json({ message: 'Failed to initialize user account. Please try again.' });
            }
        }

        logger.info('[getUserCredits] Request completed successfully', {
            userId,
            credits: user.credits,
        });

        res.json({ credits: user?.credits })

    } catch (error: any) {
        logger.error('[getUserCredits] Request failed with error', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message })
    }
}

/**
 * Get All Projects
 * 
 * Returns all projects for the authenticated user
 */
export const getAllProjects = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    logger.info('[getAllProjects] Request received', {
        userId,
        requestId: req.requestId,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[getAllProjects] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Database query: Fetch all user projects
        logger.debug('[getAllProjects] Fetching projects from database', { userId });
        const projects = await prisma.project.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        })

        logger.info('[getAllProjects] Projects fetched successfully', {
            userId,
            count: projects.length,
        });

        res.json({ projects })

    } catch (error: any) {
        logger.error('[getAllProjects] Request failed with error', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message })
    }
}

/**
 * Get Project By ID
 * 
 * Returns a specific project owned by the authenticated user
 */
export const getProjectById = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { projectId } = req.params;

    logger.info('[getProjectById] Request received', {
        userId,
        projectId,
        requestId: req.requestId,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[getProjectById] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Database query: Fetch specific project
        logger.debug('[getProjectById] Fetching project from database', { userId, projectId });
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId }
        })

        if (!project) {
            logger.warn('[getProjectById] Project not found', { userId, projectId });
            return res.status(404).json({ message: 'Project not found' });
        }

        logger.info('[getProjectById] Project fetched successfully', { userId, projectId });
        res.json({ project })

    } catch (error: any) {
        logger.error('[getProjectById] Request failed with error', {
            userId,
            projectId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message })
    }
}

/**
 * Toggle Project Public Status
 * 
 * Publishes or unpublishes a project for public viewing
 */
export const toggleProjectPublic = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { projectId } = req.params;

    logger.info('[toggleProjectPublic] Request received', {
        userId,
        projectId,
        requestId: req.requestId,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[toggleProjectPublic] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Database query: Fetch project to verify ownership and status
        logger.debug('[toggleProjectPublic] Fetching project from database', { userId, projectId });
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId }
        })

        if (!project) {
            logger.warn('[toggleProjectPublic] Project not found', { userId, projectId });
            return res.status(404).json({ message: 'Project not found' });
        }

        // Validation: Check if project has generated content
        if (!project?.generatedImage && !project?.generatedVideo) {
            logger.warn('[toggleProjectPublic] Cannot publish - no generated content', {
                userId,
                projectId,
            });
            return res.status(404).json({ message: 'image or video not generated' });
        }

        const newPublishStatus = !project.isPublished;
        logger.info('[toggleProjectPublic] Toggling publish status', {
            userId,
            projectId,
            currentStatus: project.isPublished,
            newStatus: newPublishStatus,
        });

        // Database operation: Update publish status
        await prisma.project.update({
            where: { id: projectId },
            data: { isPublished: newPublishStatus }
        })

        logger.info('[toggleProjectPublic] Publish status updated successfully', {
            userId,
            projectId,
            isPublished: newPublishStatus,
        });

        res.json({ isPublished: newPublishStatus })

    } catch (error: any) {
        logger.error('[toggleProjectPublic] Request failed with error', {
            userId,
            projectId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message })
    }
}