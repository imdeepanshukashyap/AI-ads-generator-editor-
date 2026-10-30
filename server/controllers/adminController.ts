import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../configs/prisma.js';
import { CREDITED_STATUSES } from '../services/paymentService.js';
import { adjustUserCredits, generationCredits, generationStatus, generationType, getAiMonitoring, getAnalytics, getCreditTransactions, getDashboard, getUserDetails, listGenerations, listUsers, pageParams, writeAdminLog } from '../services/adminService.js';

const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
const optionalValue = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((value) => value === '' ? undefined : value, schema.optional());
const userUpdateSchema = z.object({ role: z.enum(['USER', 'ADMIN']).optional(), status: z.enum(['active', 'suspended', 'deleted']).optional() }).strict();
const creditSchema = z.object({ amount: z.number().int().positive().max(1000000), operation: z.enum(['ADD', 'REMOVE']), reason: z.string().trim().min(3).max(500) });
const settingsSchema = z.object({
    maintenanceMode: z.boolean().optional(),
    maxImageGenerations: z.number().int().positive().max(100000).optional(),
    maxVideoGenerations: z.number().int().positive().max(100000).optional(),
    defaultUserCredits: z.number().int().nonnegative().max(1000000).optional(),
    supportedLanguages: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
    generationLimits: z.record(z.string().min(1).max(50), z.number().int().nonnegative().max(100000)).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one setting is required');
const profileSchema = z.object({ name: z.string().trim().min(2).max(100) }).strict();

const ok = (res: Response, data: unknown, message: string) => res.json({ success: true, data, message });
const fail = (res: Response, error: unknown) => res.status(400).json({ success: false, message: error instanceof z.ZodError ? error.issues[0].message : 'Invalid request' });
const adminId = (res: Response) => res.locals.authUserId as string;

export const dashboard = async (_req: Request, res: Response, next: NextFunction) => { try { return ok(res, await getDashboard(), 'Dashboard fetched successfully'); } catch (e) { next(e); } };
export const currentAdmin = async (_req: Request, res: Response) => ok(res, res.locals.admin, 'Admin access verified');

export const users = async (req: Request, res: Response, next: NextFunction) => {
    try { const q = querySchema.extend({ search: optionalValue(z.string()), role: optionalValue(z.enum(['USER', 'ADMIN'])), status: optionalValue(z.enum(['active', 'suspended', 'deleted'])) }).parse(req.query); const result = await listUsers(q.page, q.limit, q.search, q.role, q.status); return res.json({ success: true, data: result.data, pagination: { page: q.page, limit: q.limit, total: result.total, totalPages: Math.ceil(result.total / q.limit) }, message: 'Users fetched successfully' }); } catch (e) { return fail(res, e); }
};

export const user = async (req: Request, res: Response, next: NextFunction) => { try { const data = await getUserDetails(req.params.id); if (!data) return res.status(404).json({ success: false, message: 'User not found' }); return ok(res, data, 'User fetched successfully'); } catch (e) { next(e); } };

export const updateUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const changes = userUpdateSchema.parse(req.body); const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, status: true } });
        if (!target) return res.status(404).json({ success: false, message: 'User not found' });
        if (target.id === adminId(res) && (changes.role === 'USER' || changes.status === 'suspended' || changes.status === 'deleted')) return res.status(403).json({ success: false, message: 'You cannot remove your own admin access' });
        if (target.role === 'ADMIN' && target.id !== adminId(res)) return res.status(403).json({ success: false, message: 'Existing admin accounts require system-level changes' });
        const updated = await prisma.user.update({ where: { id: target.id }, data: changes, select: { id: true, name: true, email: true, role: true, status: true, credits: true } });
        await writeAdminLog({ adminId: adminId(res), action: changes.status === 'suspended' ? 'USER_BLOCKED' : changes.status === 'active' ? 'USER_UNBLOCKED' : 'USER_ROLE_CHANGED', targetType: 'USER', targetId: target.id, description: `Updated user ${target.id}`, metadata: changes, req });
        return ok(res, updated, 'User updated successfully');
    } catch (e) { return fail(res, e); }
};

export const deleteUser = async (req: Request, res: Response, next: NextFunction) => {
    try { const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true } }); if (!target) return res.status(404).json({ success: false, message: 'User not found' }); if (target.role === 'ADMIN' || target.id === adminId(res)) return res.status(403).json({ success: false, message: 'Admin accounts cannot be deleted here' }); const updated = await prisma.user.update({ where: { id: target.id }, data: { status: 'deleted' }, select: { id: true, status: true } }); await writeAdminLog({ adminId: adminId(res), action: 'USER_BLOCKED', targetType: 'USER', targetId: target.id, description: `Soft-deleted user ${target.id}`, req }); return ok(res, updated, 'User deactivated successfully'); } catch (e) { next(e); }
};

export const generations = async (req: Request, res: Response, next: NextFunction) => { try { const q = querySchema.extend({ type: optionalValue(z.enum(['image', 'video', 'carousel'])), status: optionalValue(z.enum(['PROCESSING', 'SUCCESS', 'FAILED'])), userId: optionalValue(z.string()), search: optionalValue(z.string()) }).parse(req.query); const result = await listGenerations(q.page, q.limit, q); return res.json({ success: true, data: result.data, pagination: { page: q.page, limit: q.limit, total: result.total, totalPages: Math.ceil(result.total / q.limit) }, message: 'Generations fetched successfully' }); } catch (e) { return fail(res, e); } };

export const generation = async (req: Request, res: Response, next: NextFunction) => { try { const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: { user: { select: { id: true, name: true, email: true } } } }); if (!project) return res.status(404).json({ success: false, message: 'Generation not found' }); return ok(res, { ...project, type: generationType(project), status: generationStatus(project), creditsConsumed: generationCredits(project), model: process.env.GOOGLE_IMAGE_MODEL || 'Google Gemini / Veo' }, 'Generation fetched successfully'); } catch (e) { next(e); } };

export const deleteGeneration = async (req: Request, res: Response, next: NextFunction) => { try { const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { id: true } }); if (!project) return res.status(404).json({ success: false, message: 'Generation not found' }); await prisma.project.delete({ where: { id: project.id } }); await writeAdminLog({ adminId: adminId(res), action: 'GENERATION_DELETED', targetType: 'GENERATION', targetId: project.id, description: `Deleted generation ${project.id}`, req }); return ok(res, { id: project.id }, 'Generation deleted successfully'); } catch (e) { next(e); } };

export const credits = async (_req: Request, res: Response, next: NextFunction) => { try { const [issued, users, projects, usage] = await Promise.all([prisma.transaction.aggregate({ where: { status: { in: CREDITED_STATUSES } }, _sum: { credits: true } }), prisma.user.findMany({ select: { id: true, name: true, email: true, credits: true } }), prisma.project.findMany({ select: { generatedImage: true, generatedVideo: true, generatedImages: true } }), prisma.project.groupBy({ by: ['userId'], _count: { _all: true }, orderBy: { _count: { userId: 'desc' } }, take: 10 })]); const usageByUser = usage.map((entry) => ({ ...entry, user: users.find((user) => user.id === entry.userId) })); return ok(res, { totalCreditsIssued: issued._sum.credits || 0, totalCreditsConsumed: projects.reduce((sum, p) => sum + generationCredits(p), 0), totalCreditsRemaining: (await prisma.user.aggregate({ _sum: { credits: true } }))._sum.credits || 0, topUsersByUsage: usageByUser, dailyUsage: [], monthlyUsage: [] }, 'Credits fetched successfully'); } catch (e) { next(e); } };

export const creditTransactions = async (req: Request, res: Response) => { try { const q = querySchema.extend({ userId: optionalValue(z.string()), type: optionalValue(z.enum(['ADD', 'REMOVE', 'GENERATION_USAGE', 'REFUND'])) }).parse(req.query); const result = await getCreditTransactions(q.page, q.limit, q.userId, q.type); return res.json({ success: true, data: result.data, pagination: { page: q.page, limit: q.limit, total: result.total, totalPages: Math.ceil(result.total / q.limit) }, message: 'Credit transactions fetched successfully' }); } catch (e) { return fail(res, e); } };

export const updateCredits = async (req: Request, res: Response, next: NextFunction) => { try { const input = creditSchema.parse(req.body); const result = await adjustUserCredits(prisma, { ...input, userId: req.params.id, adminId: adminId(res), ipAddress: req.ip, userAgent: req.get('user-agent') }); if (result.status === 'not_found') return res.status(404).json({ success: false, message: 'User not found' }); if (result.status === 'insufficient_credits') return res.status(409).json({ success: false, message: 'Credits cannot become negative' }); return ok(res, result.user, 'Credits updated successfully'); } catch (e) { return fail(res, e); } };

export const analytics = async (req: Request, res: Response, next: NextFunction) => { try { const period = z.enum(['7d', '30d', '90d', '1y']).default('7d').parse(req.query.period); return ok(res, await getAnalytics(period === '1y' ? 365 : Number(period.slice(0, -1))), 'Analytics fetched successfully'); } catch (e) { return fail(res, e); } };

export const aiMonitoring = async (_req: Request, res: Response, next: NextFunction) => { try { return ok(res, await getAiMonitoring(), 'AI monitoring fetched successfully'); } catch (e) { next(e); } };

export const logs = async (req: Request, res: Response, next: NextFunction) => { try { const q = querySchema.extend({ action: z.string().optional(), adminId: z.string().optional() }).parse(req.query); const where = { ...(q.action ? { action: q.action } : {}), ...(q.adminId ? { adminId: q.adminId } : {}) }; const [total, data] = await Promise.all([prisma.adminLog.count({ where }), prisma.adminLog.findMany({ where, ...pageParams(q.page, q.limit), orderBy: { createdAt: 'desc' }, include: { admin: { select: { id: true, name: true, email: true } } } })]); return res.json({ success: true, data, pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) }, message: 'Logs fetched successfully' }); } catch (e) { return fail(res, e); } };

export const settings = async (_req: Request, res: Response, next: NextFunction) => { try { return ok(res, await prisma.systemSetting.findMany(), 'Settings fetched successfully'); } catch (e) { next(e); } };
export const updateSettings = async (req: Request, res: Response, next: NextFunction) => { try { const values = settingsSchema.parse(req.body); const data = await prisma.$transaction(Object.entries(values).map(([key, value]) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } }))); await writeAdminLog({ adminId: adminId(res), action: 'SETTINGS_UPDATED', targetType: 'SETTINGS', description: 'Updated system settings', metadata: values, req }); return ok(res, data, 'Settings updated successfully'); } catch (e) { return fail(res, e); } };

export const health = async (_req: Request, res: Response) => { let database = 'healthy'; try { await prisma.$queryRaw`SELECT 1`; } catch { database = 'unhealthy'; } return res.json({ success: database === 'healthy', server: 'healthy', database, aiService: process.env.GOOGLE_CLOUD_API_KEY ? 'configured' : 'unhealthy', storage: process.env.CLOUDINARY_URL ? 'configured' : 'unhealthy', timestamp: new Date().toISOString() }); };

export const profile = async (_req: Request, res: Response, next: NextFunction) => { try { const data = await prisma.user.findUnique({ where: { id: adminId(res) }, select: { id: true, name: true, email: true, image: true, role: true, status: true, createdAt: true, updatedAt: true } }); return data ? ok(res, { ...data, lastLoginAt: data.updatedAt }, 'Admin profile fetched successfully') : res.status(404).json({ success: false, message: 'Admin profile not found' }); } catch (e) { next(e); } };
export const updateProfile = async (req: Request, res: Response, next: NextFunction) => { try { const changes = profileSchema.parse(req.body); const data = await prisma.user.update({ where: { id: adminId(res) }, data: changes, select: { id: true, name: true, email: true, image: true, role: true, status: true, createdAt: true, updatedAt: true } }); await writeAdminLog({ adminId: adminId(res), action: 'PROFILE_UPDATED', targetType: 'ADMIN', targetId: adminId(res), description: 'Updated admin profile', metadata: changes, req }); return ok(res, data, 'Admin profile updated successfully'); } catch (e) { return fail(res, e); } };