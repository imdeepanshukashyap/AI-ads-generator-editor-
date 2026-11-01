import { Request, Response, NextFunction } from 'express';
import * as Sentry from "@sentry/node"
import { getAuth } from '@clerk/express';
import logger from '../configs/logger.js';
import { prisma } from '../configs/prisma.js';

export const ACTIVE_STATUS = 'active';

interface ProtectDeps {
    /** Clerk user id of the signed-in user, or null/undefined when not signed in. */
    getUserId(req: Request): string | null | undefined;
    /** The user's account status, or null when there is no database record yet. */
    findUserStatus(userId: string): Promise<string | null>;
}

/** Looks up the account status; null means the user has not been created in our database yet. */
export const findUserStatus = async (userId: string): Promise<string | null> =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { status: true } }))?.status ?? null;

/**
 * Builds the protect middleware.
 *
 * Requires a Clerk session, then checks the account status in our database:
 * - active: allowed;
 * - no record yet: allowed, because first-time users are created (as active)
 *   by the controllers before the Clerk user.created webhook may have arrived;
 * - any other status (suspended, deleted, unknown): refused with 403;
 * - status lookup failure: refused with 503, never let through.
 */
export const createProtect = (deps: ProtectDeps) => async (req: Request, res: Response, next: NextFunction) => {
    let userId: string | null | undefined;
    try {
        userId = deps.getUserId(req)
    } catch (error: any) {
        logger.error('[protect] Authentication error', {
            error: error.message,
            stack: error.stack,
            path: req.path,
            requestId: req.requestId,
        });
        Sentry.captureException(error)
        return res.status(401).json({ message: error.code || error.message })
    }

    if (!userId) {
        logger.warn('[protect] Authentication failed - no userId', {
            path: req.path,
            method: req.method,
            requestId: req.requestId,
        });
        return res.status(401).json({ message: 'Unauthorized' })
    }

    let status: string | null;
    try {
        status = await deps.findUserStatus(userId)
    } catch (error: any) {
        logger.error('[protect] Could not check account status', {
            userId,
            error: error.message,
            path: req.path,
            requestId: req.requestId,
        });
        Sentry.captureException(error)
        return res.status(503).json({ message: 'We could not verify your account right now. Please try again shortly.' })
    }

    if (status !== null && status !== ACTIVE_STATUS) {
        logger.warn('[protect] Blocked request from inactive account', {
            userId,
            accountStatus: status,
            path: req.path,
            method: req.method,
            requestId: req.requestId,
        });
        return res.status(403).json({
            message: status === 'suspended'
                ? 'Your account has been suspended. Please contact support.'
                : 'This account is no longer active. Please contact support.',
            accountStatus: status,
        })
    }

    logger.debug('[protect] Authentication successful', {
        userId,
        path: req.path,
        requestId: req.requestId,
    });

    next()
}

/**
 * Protect Middleware
 *
 * Ensures the request is authenticated via Clerk and the account is active.
 */
export const protect = createProtect({
    getUserId: (req) => getAuth(req).userId,
    findUserStatus,
})
