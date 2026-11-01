import 'dotenv/config';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express, { type Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * File uploads are authorized before multer writes anything to disk: signed-out,
 * suspended and deleted accounts are refused without a temporary file being created,
 * while active users' uploads still reach the controller. Type, size and count limits
 * reject files before they are kept, and temporary files are deleted however a request
 * ends. Uses the real project and admin routers against a real PostgreSQL database;
 * Clerk is stood in for by a header.
 *
 *   PAYMENT_TEST_DATABASE_URL=<disposable test db url> npm run test:integration
 *
 * Only touches rows whose ids start with this run's prefix and deletes them afterwards.
 * No request gets far enough to call Google AI or Cloudinary.
 */
const databaseUrl = process.env.PAYMENT_TEST_DATABASE_URL;

if (databaseUrl && [process.env.DATABASE_URL, process.env.DIRECT_URL].includes(databaseUrl)) {
    throw new Error('PAYMENT_TEST_DATABASE_URL must not be the application database (DATABASE_URL / DIRECT_URL).');
}

const run = `itest_upload_${crypto.randomBytes(4).toString('hex')}`;

type Layer = { route?: { path: string; stack: Array<{ handle: Function }> }; handle: Function };
const stackOf = (router: Router) => (router as unknown as { stack: Layer[] }).stack;
const isUpload = (handle: Function) => handle.name === 'acceptedUpload';
const MB = 1024 * 1024;

type UploadFile = { type: string; name?: string; bytes?: number };
const png: UploadFile = { type: 'image/png' };

describe('file uploads are authorized before anything is written to disk', { skip: databaseUrl ? false : 'PAYMENT_TEST_DATABASE_URL not set' }, () => {
    let prisma: PrismaClient;
    let projectRouter: Router;
    let adminRouter: Router;
    let protect: Function;
    let authMiddleware: Function;
    let adminMiddleware: Function;
    let server: Server;
    let baseUrl: string;
    let uploadDir: string;
    let writes: ReturnType<typeof mock.method>;
    let seq = 0;

    before(async () => {
        // This file runs in its own process, so these overrides are contained.
        process.env.DATABASE_URL = databaseUrl;
        process.env.LOG_LEVEL = 'error';
        // multer's disk storage has no destination, so it writes to os.tmpdir(); point that at an empty folder.
        uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), `${run}-`));
        process.env.TMPDIR = process.env.TMP = process.env.TEMP = uploadDir;
        assert.equal(os.tmpdir(), uploadDir);
        // multer's disk storage opens one write stream per stored file.
        writes = mock.method(fs, 'createWriteStream');

        ({ prisma } = await import('../../configs/prisma.js'));
        ({ protect } = await import('../../middlewares/auth.js'));
        ({ authMiddleware, adminMiddleware } = await import('../../middlewares/adminAuth.js'));
        projectRouter = (await import('../../routes/projectRoutes.js')).default;
        adminRouter = (await import('../../routes/adminRoutes.js')).default;
        const modelLibraryRouter = (await import('../../routes/modelLibraryRoutes.js')).default;
        const { adminErrorHandler } = await import('../../middlewares/adminError.js');

        const app = express();
        app.use(express.json());
        // Stands in for clerkMiddleware(): the x-test-user header is the signed-in Clerk user, if any.
        app.use((req, _res, next) => {
            const userId = req.header('x-test-user') ?? null;
            (req as any).auth = () => ({ userId, tokenType: 'session_token' });
            next();
        });
        app.use('/api/project', projectRouter);
        app.use('/api/admin', adminRouter);
        app.use('/api/model-library', modelLibraryRouter);
        app.use(adminErrorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(async () => {
        server?.close();
        mock.restoreAll();
        if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
        if (!prisma) return;
        const mine = { startsWith: run };
        await prisma.modelLibraryEntry.deleteMany({ where: { createdById: mine } });
        await prisma.adminLog.deleteMany({ where: { adminId: mine } });
        await prisma.user.deleteMany({ where: { id: mine } });
        await prisma.$disconnect();
    });

    beforeEach(() => {
        writes.mock.resetCalls();
        for (const file of fs.readdirSync(uploadDir)) fs.rmSync(path.join(uploadDir, file), { force: true });
    });

    const createUser = async (data: { role?: string; status?: string; credits?: number } = {}) => {
        const id = `${run}_user${++seq}`;
        await prisma.user.create({ data: { id, email: `${id}@example.test`, name: `Person ${seq}`, image: '', ...data } });
        return id;
    };

    const upload = (route: string, field: string, userId: string | null, files: UploadFile[] = [png], fields: Record<string, string> = {}) => {
        const form = new FormData();
        for (const [name, value] of Object.entries(fields)) form.append(name, value);
        files.forEach((file, i) => form.append(field, new Blob([Buffer.alloc(file.bytes ?? 2048, i + 1)], { type: file.type }), file.name ?? `photo${i}.png`));
        return fetch(`${baseUrl}${route}`, { method: 'POST', headers: userId ? { 'x-test-user': userId } : {}, body: form });
    };

    /** The cleanup runs as the controller finishes, which can be just after the response arrives. */
    const filesLeftAfterCleanup = async () => {
        for (let i = 0; i < 40 && fs.readdirSync(uploadDir).length > 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
        return fs.readdirSync(uploadDir).length;
    };

    const stored = () => ({
        writes: writes.mock.calls.filter((call) => String(call.arguments[0]).startsWith(uploadDir)).length,
        files: fs.readdirSync(uploadDir).length,
    });

    describe('route order', () => {
        it('runs protect before the upload middleware on every project route that accepts files', () => {
            const uploadRoutes = stackOf(projectRouter).filter((layer) => layer.route?.stack.some((l) => isUpload(l.handle)));
            assert.deepEqual(uploadRoutes.map((layer) => layer.route!.path).sort(), ['/create', '/create-bundle']);
            for (const layer of uploadRoutes) {
                const handles = layer.route!.stack.map((l) => l.handle);
                const protectAt = handles.indexOf(protect);
                assert.ok(protectAt >= 0 && protectAt < handles.findIndex(isUpload), `${layer.route!.path}: protect must come before upload`);
            }
        });

        it('runs the admin checks before the upload middleware on every admin route that accepts files', () => {
            const stack = stackOf(adminRouter);
            const authAt = stack.findIndex((layer) => !layer.route && layer.handle === authMiddleware);
            const adminAt = stack.findIndex((layer) => !layer.route && layer.handle === adminMiddleware);
            const firstUploadAt = stack.findIndex((layer) => layer.route?.stack.some((l) => isUpload(l.handle)));
            assert.ok(firstUploadAt > 0, 'admin router has upload routes');
            assert.ok(authAt >= 0 && authAt < adminAt && adminAt < firstUploadAt);
        });
    });

    for (const route of ['/api/project/create', '/api/project/create-bundle']) {
        describe(`POST ${route}`, () => {
            it('refuses a signed-out request without storing the upload', async () => {
                const res = await upload(route, 'images', null, [png, png]);
                assert.equal(res.status, 401);
                assert.deepEqual(stored(), { writes: 0, files: 0 });
            });

            for (const status of ['suspended', 'deleted']) {
                it(`refuses a ${status} account without storing the upload`, async () => {
                    const res = await upload(route, 'images', await createUser({ status }), [png, png]);
                    assert.equal(res.status, 403);
                    assert.equal((await res.json()).accountStatus, status);
                    assert.deepEqual(stored(), { writes: 0, files: 0 });
                });
            }

            it('still accepts the upload from an active account, and deletes it when validation fails', async () => {
                // No productName, so the controller stops at validation before any AI or database work.
                const res = await upload(route, 'images', await createUser(), [png, png]);
                assert.equal(res.status, 400);
                assert.equal(stored().writes, 2, 'both images reached the disk storage');
                assert.equal(await filesLeftAfterCleanup(), 0);
            });

            it('deletes the upload when the request fails for lack of credits', async () => {
                const res = await upload(route, 'images', await createUser({ credits: 0 }), [png, png], { productName: 'Bottle' });
                assert.equal(res.status, 403);
                assert.equal(stored().writes, 2);
                assert.equal(await filesLeftAfterCleanup(), 0);
            });

            it('accepts HEIC photos, including ones sent without a specific type', async () => {
                const res = await upload(route, 'images', await createUser(), [{ type: 'image/heic', name: 'a.heic' }, { type: 'application/octet-stream', name: 'b.HEIC' }]);
                assert.equal(res.status, 400, 'reached the controller');
                assert.equal(stored().writes, 2);
                assert.equal(await filesLeftAfterCleanup(), 0);
            });

            it('refuses an unsupported file type and keeps nothing', async () => {
                const res = await upload(route, 'images', await createUser(), [png, { type: 'image/gif', name: 'c.gif' }]);
                assert.equal(res.status, 400);
                assert.match((await res.json()).message, /JPEG, PNG, WebP or HEIC/);
                assert.equal(stored().files, 0);
            });

            it('refuses an image over 20 MB with 413 and keeps nothing', async () => {
                const res = await upload(route, 'images', await createUser(), [png, { type: 'image/png', bytes: 20 * MB + 1 }]);
                assert.equal(res.status, 413);
                assert.equal((await res.json()).message, 'Each image must be 20 MB or smaller.');
                assert.equal(stored().files, 0);
            });

            it('refuses more than two images and keeps nothing', async () => {
                const res = await upload(route, 'images', await createUser(), [png, png, png]);
                assert.equal(res.status, 400);
                assert.equal(stored().files, 0);
            });
        });
    }

    describe('POST /api/admin/model-library', () => {
        it('refuses non-admin, suspended and deleted admin accounts without storing the upload', async () => {
            for (const userId of [await createUser(), await createUser({ role: 'ADMIN', status: 'suspended' }), await createUser({ role: 'ADMIN', status: 'deleted' })]) {
                const res = await upload('/api/admin/model-library', 'image', userId);
                assert.equal(res.status, 403);
            }
            assert.deepEqual(stored(), { writes: 0, files: 0 });
        });

        it('answers an admin image over 10 MB with 413 instead of a server error, and keeps nothing', async () => {
            const res = await upload('/api/admin/model-library', 'image', await createUser({ role: 'ADMIN' }), [{ type: 'image/png', bytes: 10 * MB + 1 }]);
            assert.equal(res.status, 413);
            assert.equal((await res.json()).message, 'Each image must be 10 MB or smaller.');
            assert.equal(stored().files, 0);
        });

        it('does not store an admin image of an unsupported type', async () => {
            const res = await upload('/api/admin/model-library', 'image', await createUser({ role: 'ADMIN' }), [{ type: 'image/gif', name: 'm.gif' }]);
            assert.equal(res.status, 400);
            assert.deepEqual(stored(), { writes: 0, files: 0 });
        });
    });

    describe('admin model library management (details only, no image upload)', () => {
        const call = (method: string, route: string, userId: string | null, body?: unknown) => fetch(`${baseUrl}${route}`, {
            method,
            headers: { ...(userId ? { 'x-test-user': userId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const createModel = async (adminId: string) => prisma.modelLibraryEntry.create({
            data: {
                name: `${run} model ${++seq}`, description: 'Studio portrait', category: 'Fashion', tags: ['studio', 'female'],
                imageUrl: 'https://example.test/m.png', imagePublicId: `m_${seq}`, isPublished: false, createdById: adminId,
            },
        });
        const details = async (id: string) => {
            const { name, description, category, tags } = await prisma.modelLibraryEntry.findUniqueOrThrow({ where: { id } });
            return { name, description, category, tags };
        };

        it('publishes and unpublishes a model, which controls public visibility, and audit-logs each change', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const model = await createModel(adminId);
            assert.equal((await call('GET', `/api/model-library/${model.id}`, null)).status, 404, 'unpublished models are hidden');

            // The admin page's publish toggle sends only isPublished.
            assert.equal((await call('PATCH', `/api/admin/model-library/${model.id}`, adminId, { isPublished: true })).status, 200);
            assert.equal((await call('GET', `/api/model-library/${model.id}`, null)).status, 200);

            assert.equal((await call('PATCH', `/api/admin/model-library/${model.id}`, adminId, { isPublished: false })).status, 200);
            assert.equal((await call('GET', `/api/model-library/${model.id}`, null)).status, 404);
            assert.equal(await prisma.adminLog.count({ where: { adminId, targetId: model.id, action: 'MODEL_LIBRARY_UPDATED' } }), 2);
        });

        it('keeps the other details when only the publish state changes', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const model = await createModel(adminId);
            const before = await details(model.id);
            assert.equal((await call('PATCH', `/api/admin/model-library/${model.id}`, adminId, { isPublished: true })).status, 200);
            assert.deepEqual(await details(model.id), before);

            assert.equal((await call('PATCH', `/api/admin/model-library/${model.id}`, adminId, { tags: 'studio, male' })).status, 200);
            assert.deepEqual(await details(model.id), { ...before, tags: ['studio', 'male'] });
        });

        it('rejects invalid or empty model changes with 400 and changes nothing', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const model = await createModel(adminId);
            for (const body of [{ name: 'x' }, { unexpected: true }, { tags: 'a'.repeat(31) }]) {
                const res = await call('PATCH', `/api/admin/model-library/${model.id}`, adminId, body);
                assert.equal(res.status, 400, JSON.stringify(body));
                assert.equal((await res.json()).success, false);
            }
            assert.equal((await call('PATCH', `/api/admin/model-library/${model.id}`, adminId, {})).status, 400, 'no changes');
            assert.equal((await prisma.modelLibraryEntry.findUniqueOrThrow({ where: { id: model.id } })).name, model.name);
        });

        it('deletes a model, which removes it from the public library, and audit-logs it', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const model = await createModel(adminId);
            await prisma.modelLibraryEntry.update({ where: { id: model.id }, data: { isPublished: true } });

            assert.equal((await call('DELETE', `/api/admin/model-library/${model.id}`, adminId)).status, 200);
            assert.equal((await call('GET', `/api/model-library/${model.id}`, null)).status, 404);
            assert.equal(await prisma.adminLog.count({ where: { adminId, targetId: model.id, action: 'MODEL_LIBRARY_DELETED' } }), 1);
        });

        it('refuses model management to non-admin and suspended admin accounts', async () => {
            const owner = await createUser({ role: 'ADMIN' });
            const model = await createModel(owner);
            for (const userId of [await createUser(), await createUser({ role: 'ADMIN', status: 'suspended' })]) {
                assert.equal((await call('PATCH', `/api/admin/model-library/${model.id}`, userId, { isPublished: true })).status, 403);
                assert.equal((await call('DELETE', `/api/admin/model-library/${model.id}`, userId)).status, 403);
            }
            assert.equal((await prisma.modelLibraryEntry.findUniqueOrThrow({ where: { id: model.id } })).isPublished, false);
        });
    });
});
