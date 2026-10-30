import type { Request, RequestHandler, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

const storage = multer.diskStorage({});

const MB = 1024 * 1024;

// Product and model photos for generation, in the formats Gemini accepts. HEIC/HEIF photos
// sometimes arrive without a specific content type, so their extension also counts.
export const PROJECT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const PROJECT_IMAGE_MAX_BYTES = 20 * MB;
export const MODEL_LIBRARY_IMAGE_MAX_BYTES = 10 * MB;

class UnsupportedUploadError extends Error {}

const isProjectImage = (file: Express.Multer.File) =>
  PROJECT_IMAGE_TYPES.includes(file.mimetype) || ['.heic', '.heif'].includes(path.extname(file.originalname).toLowerCase());

const upload = multer({
  storage,
  limits: { fileSize: PROJECT_IMAGE_MAX_BYTES, files: 2, fields: 20 },
  fileFilter: (_req, file, callback) => {
    if (isProjectImage(file)) callback(null, true);
    else callback(new UnsupportedUploadError('Please upload JPEG, PNG, WebP or HEIC images only.'));
  },
});

export const modelLibraryUpload = multer({
  storage,
  limits: { fileSize: MODEL_LIBRARY_IMAGE_MAX_BYTES },
  fileFilter: (_req, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

/**
 * Runs a multer middleware and answers its rejections with a 4xx JSON error instead of
 * the generic 500. Multer has already removed any file it stored for the rejected request.
 */
export const acceptUploads = (middleware: RequestHandler, maxBytes: number): RequestHandler =>
  function acceptedUpload(req, res, next) {
    middleware(req, res, (error?: unknown) => {
      if (!error) return next();
      if (error instanceof UnsupportedUploadError) return res.status(400).json({ success: false, message: error.message });
      if (!(error instanceof multer.MulterError)) return next(error);
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: `Each image must be ${maxBytes / MB} MB or smaller.` });
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ success: false, message: 'Too many files, or a file was sent in an unexpected field.' });
      }
      return res.status(400).json({ success: false, message: error.message });
    });
  };

/** Deletes the request's temporary upload files; missing files are ignored. */
export const removeUploadedFiles = async (req: Request) => {
  const files = [req.file, ...(Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat())];
  await Promise.all(files.map((file) => file?.path && fs.promises.rm(file.path, { force: true }).catch(() => undefined)));
};

/**
 * Wraps a controller so its temporary upload files are deleted once it finishes, however it
 * ends: success, validation failure, early return or thrown error. The controllers finish all
 * work with the files before returning, so nothing reads them afterwards.
 */
export const withUploadCleanup = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  async (req, res) => {
    try {
      await handler(req, res);
    } finally {
      await removeUploadedFiles(req);
    }
  };

export default upload;
