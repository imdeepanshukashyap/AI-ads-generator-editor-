import { Request, Response, NextFunction } from 'express';

export const adminErrorHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
    if (!req.originalUrl.startsWith('/api/admin')) return next(error);
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    res.status(status).json({ success: false, message: status === 500 ? 'Internal server error' : error.message });
};