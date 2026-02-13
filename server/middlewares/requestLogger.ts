import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../configs/logger.js';
import { getAuth } from '@clerk/express';

// Extend Express Request to include requestId and logger
declare global {
    namespace Express {
        interface Request {
            requestId?: string;
            logger?: any;
            startTime?: number;
        }
    }
}

/**
 * Request Logger Middleware
 * 
 * Generates unique request IDs for tracing, logs request entry/exit,
 * tracks request duration, and attaches contextual logger to request object.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    // Generate unique request ID for tracing
    req.requestId = uuidv4();
    req.startTime = Date.now();

    // Get userId if available (after auth middleware)
    const { userId } = getAuth(req);

    // Create context logger with request metadata
    req.logger = logger.child({
        requestId: req.requestId,
        userId: userId || 'anonymous',
    });

    // Log incoming request
    req.logger.info('Request received', {
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip,
        userAgent: req.get('user-agent'),
    });

    // Capture response finish event to log completion
    const originalSend = res.send;
    res.send = function (data: any) {
        const duration = Date.now() - (req.startTime || Date.now());

        // Log response completion
        req.logger.info('Request completed', {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
        });

        return originalSend.call(this, data);
    };

    next();
};

/**
 * Error Logger Middleware
 * 
 * Logs unhandled errors with full stack traces and context.
 * Should be registered after all routes.
 */
export const errorLogger = (err: Error, req: Request, res: Response, next: NextFunction) => {
    const duration = Date.now() - (req.startTime || Date.now());

    // Log error with full context
    (req.logger || logger).error('Request failed with error', {
        error: err.message,
        stack: err.stack,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode || 500,
        duration: `${duration}ms`,
        requestId: req.requestId,
    });

    next(err);
};
