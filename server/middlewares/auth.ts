import { Request, Response, NextFunction } from 'express';
import * as Sentry from "@sentry/node"
import { getAuth } from '@clerk/express';
import logger from '../configs/logger.js';

/**
 * Protect Middleware
 * 
 * Ensures the request is authenticated via Clerk
 */
export const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId } = getAuth(req)

        if (!userId) {
            logger.warn('[protect] Authentication failed - no userId', {
                path: req.path,
                method: req.method,
                requestId: req.requestId,
            });
            return res.status(401).json({ message: 'Unauthorized' })
        }

        logger.debug('[protect] Authentication successful', {
            userId,
            path: req.path,
            requestId: req.requestId,
        });

        next()
    } catch (error: any) {
        logger.error('[protect] Authentication error', {
            error: error.message,
            stack: error.stack,
            path: req.path,
            requestId: req.requestId,
        });
        Sentry.captureException(error)
        res.status(401).json({ message: error.code || error.message })
    }
}