import { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { prisma } from '../configs/prisma.js';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const { userId } = getAuth(req);
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    res.locals.authUserId = userId;
    next();
};

export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: res.locals.authUserId },
            select: { id: true, role: true, status: true },
        });

        if (!user || user.status !== 'active') {
            return res.status(403).json({ success: false, message: 'Admin access forbidden' });
        }
        if (user.role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: 'Admin access forbidden' });
        }

        res.locals.admin = user;
        next();
    } catch (error) {
        next(error);
    }
};