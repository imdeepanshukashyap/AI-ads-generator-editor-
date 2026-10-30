import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import type { Request, RequestHandler, Response } from 'express';
import { acceptUploads, removeUploadedFiles, withUploadCleanup } from '../configs/multer.js';

const MB = 1024 * 1024;

/** Runs acceptUploads around a stand-in multer middleware that ends with `error`. */
const acceptWith = (error?: unknown) =>
    new Promise<{ status?: number; body?: any; passedOn?: { error?: unknown } }>((resolve) => {
        const res: any = {
            status: (code: number) => { res.code = code; return res; },
            json: (body: unknown) => { resolve({ status: res.code, body }); return res; },
        };
        const middleware: RequestHandler = (_req, _res, next) => next(error);
        acceptUploads(middleware, 20 * MB)({} as Request, res as Response, (passed?: unknown) => resolve({ passedOn: { error: passed } }));
    });

describe('acceptUploads', () => {
    it('passes an accepted upload on to the controller', async () => {
        assert.deepEqual(await acceptWith(), { passedOn: { error: undefined } });
    });

    it('answers a file over the size limit with 413 and the limit', async () => {
        const { status, body } = await acceptWith(new multer.MulterError('LIMIT_FILE_SIZE', 'images'));
        assert.equal(status, 413);
        assert.deepEqual(body, { success: false, message: 'Each image must be 20 MB or smaller.' });
    });

    it('answers too many files, or a file in an unexpected field, with 400', async () => {
        for (const code of ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'] as const) {
            const { status, body } = await acceptWith(new multer.MulterError(code, 'images'));
            assert.equal(status, 400, code);
            assert.equal(body.success, false);
        }
    });

    it('answers other upload limits with 400', async () => {
        const { status } = await acceptWith(new multer.MulterError('LIMIT_FIELD_COUNT'));
        assert.equal(status, 400);
    });

    it('passes errors that are not upload rejections on to the error handler', async () => {
        const error = new Error('disk full');
        assert.deepEqual(await acceptWith(error), { passedOn: { error } });
    });
});

const tempFiles = (count: number) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-cleanup-test-'));
    const files = Array.from({ length: count }, (_, i) => {
        const file = path.join(dir, `upload${i}`);
        fs.writeFileSync(file, 'temporary upload');
        return { path: file } as Express.Multer.File;
    });
    return { dir, files, remaining: () => fs.readdirSync(dir).length, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

const call = (handler: RequestHandler, req: Partial<Request>) => handler(req as Request, {} as Response, () => undefined);

describe('withUploadCleanup', () => {
    it('deletes the temporary files when the controller returns', async () => {
        const t = tempFiles(2);
        try {
            let seenDuringHandler = 0;
            await call(withUploadCleanup(async () => { seenDuringHandler = t.remaining(); }), { files: t.files });
            assert.equal(seenDuringHandler, 2, 'files stay available while the controller runs');
            assert.equal(t.remaining(), 0);
        } finally { t.done(); }
    });

    it('deletes the temporary files when the controller throws, and still reports the error', async () => {
        const t = tempFiles(2);
        try {
            await assert.rejects(call(withUploadCleanup(async () => { throw new Error('generation failed'); }), { files: t.files }) as Promise<unknown>, /generation failed/);
            assert.equal(t.remaining(), 0);
        } finally { t.done(); }
    });
});

describe('removeUploadedFiles', () => {
    it('handles single-file and field-keyed uploads, and files that are already gone', async () => {
        const t = tempFiles(3);
        try {
            fs.rmSync(t.files[2].path);
            await removeUploadedFiles({ file: t.files[0], files: { images: [t.files[1], t.files[2]] } } as unknown as Request);
            assert.equal(t.remaining(), 0);
            await removeUploadedFiles({} as Request);
        } finally { t.done(); }
    });
});
