import { prisma } from '../configs/prisma.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { CREDITED_STATUSES, TRANSACTION_STATUS } from './paymentService.js';

export const pageParams = (page: number, limit: number) => ({
    skip: (page - 1) * limit,
    take: limit,
});

export const generationType = (project: { generatedVideo: string; generatedImages: string[] }) =>
    project.generatedVideo ? 'video' : project.generatedImages.length > 1 ? 'carousel' : 'image';

export const generationStatus = (project: { isGenerating: boolean; error: string; generatedImage: string }) =>
    project.isGenerating ? 'PROCESSING' : project.error ? 'FAILED' : project.generatedImage ? 'SUCCESS' : 'FAILED';

export const generationCredits = (project: { generatedVideo: string; generatedImages: string[]; generatedImage?: string }) =>
    project.generatedVideo ? 10 : project.generatedImages.length > 0 ? project.generatedImages.length * 5 : project.generatedImage ? 5 : 0;

export const writeAdminLog = async (data: {
    adminId: string; action: string; targetType: string; targetId?: string;
    description: string; metadata?: unknown; req?: { ip?: string; headers: Record<string, string | string[] | undefined> };
}) => prisma.adminLog.create({
    data: {
        adminId: data.adminId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        description: data.description,
        metadata: data.metadata as any,
        ipAddress: data.req?.ip,
        userAgent: typeof data.req?.headers['user-agent'] === 'string' ? data.req.headers['user-agent'] : undefined,
    },
});

export const getDashboard = async () => {
    const [totalUsers, activeUsers, totalGenerations, failedGenerations, credits, recentUsers, recentGenerations, recentAdminActions] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'active' } }),
        prisma.project.count(),
        prisma.project.count({ where: { error: { not: '' } } }),
        prisma.user.aggregate({ _sum: { credits: true } }),
        prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, name: true, email: true, role: true, status: true, createdAt: true } }),
        prisma.project.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, name: true, productName: true, userId: true, generatedImage: true, generatedImages: true, generatedVideo: true, isGenerating: true, error: true, createdAt: true } }),
        prisma.adminLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, adminId: true, action: true, description: true, createdAt: true } }),
    ]);
    const projects = await prisma.project.findMany({ select: { generatedImage: true, generatedVideo: true, generatedImages: true, error: true } });
    return {
        totalUsers, activeUsers, totalGenerations,
        successfulGenerations: projects.filter((project) => !project.error && (project.generatedImage || project.generatedVideo)).length,
        imageGenerations: projects.filter((p) => generationType(p) === 'image').length,
        videoGenerations: projects.filter((p) => generationType(p) === 'video').length,
        carouselGenerations: projects.filter((p) => generationType(p) === 'carousel').length,
        failedGenerations,
        totalCreditsUsed: projects.reduce((sum, project) => sum + generationCredits(project), 0),
        totalCreditsRemaining: credits._sum.credits || 0,
        recentUsers,
        recentGenerations: recentGenerations.map((project) => ({ ...project, type: generationType(project), status: generationStatus(project) })),
        recentAdminActions,
    };
};

export const listUsers = async (page: number, limit: number, search?: string, role?: string, status?: string) => {
    const where: any = {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [total, data] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({ where, ...pageParams(page, limit), orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, image: true, role: true, status: true, credits: true, createdAt: true, updatedAt: true } }),
    ]);
    return { data, total };
};

export const getUserDetails = async (id: string) => {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, image: true, role: true, status: true, credits: true, createdAt: true, updatedAt: true } });
    if (!user) return null;
    const [total, successful, failed, recentGenerations] = await Promise.all([
        prisma.project.count({ where: { userId: id } }),
        prisma.project.count({ where: { userId: id, error: '', generatedImage: { not: '' } } }),
        prisma.project.count({ where: { userId: id, error: { not: '' } } }),
        prisma.project.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return { ...user, totalGenerations: total, successfulGenerations: successful, failedGenerations: failed, lastActiveAt: user.updatedAt, recentGenerations };
};

export const listGenerations = async (page: number, limit: number, filters: { type?: string; status?: string; userId?: string; search?: string }) => {
    const projects = await prisma.project.findMany({ where: filters.userId ? { userId: filters.userId } : undefined, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' } });
    const filtered = projects.filter((project) => (!filters.type || generationType(project) === filters.type) && (!filters.status || generationStatus(project) === filters.status) && (!filters.search || `${project.name} ${project.productName} ${project.user.name}`.toLowerCase().includes(filters.search.toLowerCase())));
    return { total: filtered.length, data: filtered.slice((page - 1) * limit, page * limit).map((project) => ({ ...project, type: generationType(project), status: generationStatus(project), creditsConsumed: generationCredits(project), model: process.env.GOOGLE_IMAGE_MODEL || 'Google Gemini / Veo' })) };
};

export const getAnalytics = async (days: number) => {
    const since = new Date(Date.now() - days * 86400000);
    const [users, projects] = await Promise.all([
        prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
        prisma.project.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, error: true, generatedImage: true, generatedVideo: true, generatedImages: true } }),
    ]);
    const labels: string[] = [], userData: number[] = [], generationData: number[] = [], creditData: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() - i * 86400000); date.setHours(0, 0, 0, 0);
        const next = new Date(date); next.setDate(date.getDate() + 1);
        labels.push(date.toISOString().slice(0, 10));
        const dayProjects = projects.filter((p) => p.createdAt >= date && p.createdAt < next);
        userData.push(users.filter((u) => u.createdAt >= date && u.createdAt < next).length);
        generationData.push(dayProjects.length);
        creditData.push(dayProjects.reduce((sum, p) => sum + generationCredits(p), 0));
    }
    const successful = projects.filter((p) => !p.error && (p.generatedImage || p.generatedVideo)).length;
    return { users: { labels, data: userData }, generations: { labels, data: generationData }, credits: { labels, data: creditData }, successfulGenerations: successful, failedGenerations: projects.length - successful, successRate: projects.length ? successful / projects.length : 0, imageGenerations: projects.filter((p) => generationType(p) === 'image').length, videoGenerations: projects.filter((p) => generationType(p) === 'video').length, carouselGenerations: projects.filter((p) => generationType(p) === 'carousel').length };
};

/** Formats an amount held in the currency's smallest unit (paise for INR, as Razorpay stores it). */
export const formatMoney = (minorUnits: number, currency: string) => {
    try {
        const format = new Intl.NumberFormat('en-IN', { style: 'currency', currency });
        return format.format(minorUnits / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
    } catch {
        return `${(minorUnits / 100).toFixed(2)} ${currency}`;
    }
};

type PurchaseRecord = {
    id: string; userId: string; planName: string; amount: number; currency: string; credits: number; status: string; createdAt: Date;
    user: { id: string; name: string; email: string } | null;
};

/**
 * A Razorpay purchase as a credit-history row. Only a captured, credited payment is a
 * credit addition; pending, failed and refunded orders never added credits, so they are
 * labelled with their payment status and no money received. A payment refunded after its
 * credits were granted stays an addition (the credits were added) but is flagged for review;
 * the refunded amount, full or partial, is in the Razorpay Dashboard.
 */
export const toPurchaseHistoryRow = (transaction: PurchaseRecord) => {
    const credited = CREDITED_STATUSES.includes(transaction.status);
    const needsReview = transaction.status === TRANSACTION_STATUS.REFUNDED_AFTER_CREDIT;
    const money = formatMoney(transaction.amount, transaction.currency);
    return {
        id: transaction.id,
        userId: transaction.userId,
        type: credited ? 'ADD' : `PAYMENT_${transaction.status.toUpperCase()}`,
        amount: !credited
            ? `${money} · no credits added`
            : `${transaction.credits} credits · ${money}${needsReview ? ' · payment refunded after credits were added — review' : ''}`,
        moneyPaid: !credited ? 0 : needsReview ? null : transaction.amount,
        currency: transaction.currency,
        planName: transaction.planName,
        status: transaction.status,
        needsReview,
        balance: null,
        reason: transaction.status === TRANSACTION_STATUS.SUCCESS ? `${transaction.planName} purchase` : `${transaction.planName} purchase (${transaction.status})`,
        admin: null,
        user: transaction.user,
        createdAt: transaction.createdAt,
    };
};

export const getCreditTransactions = async (page: number, limit: number, userId?: string, type?: string) => {
    const where = { ...(userId ? { userId } : {}), ...(type ? { type } : {}) };
    const data = await prisma.creditTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true, email: true } }, admin: { select: { id: true, name: true, email: true } } } });
    // Purchases are listed unfiltered (every status), or as credit additions (credited only) when filtering by ADD.
    const purchases = type && type !== 'ADD' ? [] : await prisma.transaction.findMany({ where: { ...(userId ? { userId } : {}), ...(type === 'ADD' ? { status: { in: CREDITED_STATUSES } } : {}) }, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true, email: true } } } });
    const merged = [...data, ...purchases.map(toPurchaseHistoryRow)].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { total: merged.length, data: merged.slice((page - 1) * limit, page * limit) };
};

export type CreditAdjustmentDb = Pick<PrismaClient, '$transaction'>;

export type CreditAdjustment = {
    userId: string; adminId: string; amount: number; operation: 'ADD' | 'REMOVE'; reason: string; ipAddress?: string; userAgent?: string;
};

/**
 * Applies an admin credit change, its credit-history row and its audit log in one transaction.
 * The balance check is part of the UPDATE itself (credits >= amount for a removal): Postgres
 * locks the row and re-checks the condition against the latest committed balance, so
 * concurrent admin changes and payment credits can never take a balance below zero.
 */
export const adjustUserCredits = (db: CreditAdjustmentDb, input: CreditAdjustment) => db.$transaction(async (tx) => {
    const removing = input.operation === 'REMOVE';
    const { count } = await tx.user.updateMany({
        where: { id: input.userId, ...(removing ? { credits: { gte: input.amount } } : {}) },
        data: { credits: removing ? { decrement: input.amount } : { increment: input.amount } },
    });
    if (count === 0) {
        const exists = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
        return { status: exists ? 'insufficient_credits' : 'not_found' } as const;
    }
    // The row stays locked by this transaction until commit, so this is the balance the change produced.
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { id: true, credits: true } });
    await tx.creditTransaction.create({ data: { userId: input.userId, adminId: input.adminId, type: input.operation, amount: input.amount, balance: user.credits, reason: input.reason } });
    await tx.adminLog.create({ data: { adminId: input.adminId, action: removing ? 'CREDITS_REMOVED' : 'CREDITS_ADDED', targetType: 'USER', targetId: input.userId, description: input.reason, metadata: { amount: input.amount, operation: input.operation }, ipAddress: input.ipAddress, userAgent: input.userAgent } });
    return { status: 'updated', user } as const;
});

export const getAiMonitoring = async () => {
    const [projects, today, month] = await Promise.all([
        prisma.project.findMany({ select: { isGenerating: true, error: true, generatedImage: true, generatedVideo: true, generatedImages: true, createdAt: true } }),
        prisma.project.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
        prisma.project.count({ where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
    ]);
    const successful = projects.filter((project) => !project.isGenerating && !project.error && (project.generatedImage || project.generatedVideo)).length;
    const failed = projects.filter((project) => !!project.error).length;
    // Same key lookup as googleAiService; video uses Gemini Omni, not Veo.
    return { service: process.env.GOOGLE_CLOUD_API_KEY1 || process.env.GOOGLE_CLOUD_API_KEY ? 'Healthy' : 'Down', provider: 'Google Gemini',totalRequests: projects.length, successfulRequests: successful, failedRequests: failed, errorRate: projects.length ? failed / projects.length : 0, creditsConsumed: projects.reduce((sum, project) => sum + generationCredits(project), 0), requestsToday: today, requestsThisMonth: month, averageResponseTimeMs: null, averageResponseTimeAvailable: false };
};