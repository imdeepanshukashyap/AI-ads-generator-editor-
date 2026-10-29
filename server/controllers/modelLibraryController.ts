import type { NextFunction, Request, Response } from 'express';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../configs/prisma.js';
import { writeAdminLog } from '../services/adminService.js';

const metadataSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  category: z.string().trim().min(1).max(40).default('General'),
  tags: z.union([z.array(z.string().trim().min(1).max(30)).max(12), z.string().transform((value) => value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12))]).default([]),
  isPublished: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
}).strict();

const updateMetadataSchema = metadataSchema.partial();
const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  published: z.enum(['true', 'false']).optional(),
});

const ok = (res: Response, data: unknown, message: string) => res.json({ success: true, data, message });
const removeTempFile = async (file?: Express.Multer.File) => {
  if (file?.path) await unlink(file.path).catch(() => undefined);
};

const parseFileImage = (file?: Express.Multer.File) => {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || file.size > 10 * 1024 * 1024) return null;
  return file;
};

const uploadImage = async (file: Express.Multer.File) => {
  const result = await cloudinary.uploader.upload(file.path, {
    resource_type: 'image',
    folder: 'adgen/model-library',
    transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
  });
  return { imageUrl: result.secure_url, imagePublicId: result.public_id };
};

const findById = async (id: string) => prisma.modelLibraryEntry.findUnique({ where: { id } });

export const listPublishedModels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listSchema.parse(req.query);
    const search = query.search ? { contains: query.search, mode: 'insensitive' as const } : undefined;
    const where = {
      isPublished: true,
      ...(query.category ? { category: query.category } : {}),
      ...(search ? { OR: [{ name: search }, { description: search }, { tags: { has: query.search } }] } : {}),
    };
    const [data, total, categories] = await Promise.all([
      prisma.modelLibraryEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.modelLibraryEntry.count({ where }),
      prisma.modelLibraryEntry.findMany({ where: { isPublished: true }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
    ]);
    return res.json({ success: true, data, categories: categories.map(({ category }) => category), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } });
  } catch (error) { next(error); }
};

export const getPublishedModel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const model = await prisma.modelLibraryEntry.findFirst({ where: { id: req.params.id, isPublished: true } });
    if (!model) return res.status(404).json({ success: false, message: 'Model not found' });
    return ok(res, model, 'Model fetched successfully');
  } catch (error) { next(error); }
};

export const listAdminModels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listSchema.parse(req.query);
    const search = query.search ? { contains: query.search, mode: 'insensitive' as const } : undefined;
    const where = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.published ? { isPublished: query.published === 'true' } : {}),
      ...(search ? { OR: [{ name: search }, { description: search }] } : {}),
    };
    const [data, total, categories] = await Promise.all([
      prisma.modelLibraryEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit, include: { createdBy: { select: { id: true, name: true, email: true } } } }),
      prisma.modelLibraryEntry.count({ where }),
      prisma.modelLibraryEntry.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
    ]);
    return res.json({ success: true, data, categories: categories.map(({ category }) => category), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } });
  } catch (error) { next(error); }
};

export const createModel = async (req: Request, res: Response, next: NextFunction) => {
  const file = parseFileImage(req.file);
  try {
    if (!file) return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, or WebP image smaller than 10 MB' });
    const metadata = metadataSchema.parse(req.body);
    const image = await uploadImage(file);
    const model = await prisma.modelLibraryEntry.create({ data: { ...metadata, ...image, createdById: res.locals.authUserId } });
    await writeAdminLog({ adminId: res.locals.authUserId, action: 'MODEL_LIBRARY_CREATED', targetType: 'MODEL_LIBRARY', targetId: model.id, description: `Created model library entry ${model.name}`, req });
    return ok(res, model, 'Model added to library');
  } catch (error) {
    next(error);
  } finally {
    await removeTempFile(req.file);
  }
};

export const updateModel = async (req: Request, res: Response, next: NextFunction) => {
  const file = parseFileImage(req.file);
  try {
    const existing = await findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Model not found' });
    if (req.file && !file) return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, or WebP image smaller than 10 MB' });
    const metadata = updateMetadataSchema.parse(req.body);
    if (Object.keys(metadata).length === 0 && !file) return res.status(400).json({ success: false, message: 'No changes provided' });
    const image = file ? await uploadImage(file) : undefined;
    const model = await prisma.modelLibraryEntry.update({ where: { id: existing.id }, data: { ...metadata, ...image } });
    await writeAdminLog({ adminId: res.locals.authUserId, action: 'MODEL_LIBRARY_UPDATED', targetType: 'MODEL_LIBRARY', targetId: model.id, description: `Updated model library entry ${model.name}`, req, metadata: metadata as any });
    return ok(res, model, file ? 'Model image and details updated' : 'Model details updated');
  } catch (error) {
    next(error);
  } finally {
    await removeTempFile(req.file);
  }
};

export const deleteModel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const model = await findById(req.params.id);
    if (!model) return res.status(404).json({ success: false, message: 'Model not found' });
    await prisma.modelLibraryEntry.delete({ where: { id: model.id } });
    await writeAdminLog({ adminId: res.locals.authUserId, action: 'MODEL_LIBRARY_DELETED', targetType: 'MODEL_LIBRARY', targetId: model.id, description: `Deleted model library entry ${model.name}`, req });
    return ok(res, { id: model.id }, 'Model deleted. Existing projects keep their copied image URLs.');
  } catch (error) { next(error); }
};
