import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export const adminErrorHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
    if (!req.originalUrl.startsWith('/api/admin')) return next(error);
    if (res.headersSent) return next(error);
    // Invalid admin input is a client error, not a server failure.
    if (error instanceof ZodError) return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid request' });
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    res.status(status).json({ success: false, message: status === 500 ? 'Internal server error' : error.message });
};