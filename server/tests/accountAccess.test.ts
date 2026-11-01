import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';

process.env.LOG_LEVEL = 'error';

const { createProtect } = await import('../middlewares/auth.js');

/** Runs the middleware with a fake request/response and reports what happened. */
const run = async (opts: { userId?: string | null; status?: string | null; lookupFails?: boolean; authThrows?: boolean }) => {
    const middleware = createProtect({
        getUserId: () => {
            if (opts.authThrows) throw Object.assign(new Error('clerkMiddleware required'), { code: 'auth_error' });
            return opts.userId;
        },
        findUserStatus: async () => {
            if (opts.lookupFails) throw new Error('database unavailable');
            return opts.status ?? null;
        },
    });
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    let nextCalled = false;
    await middleware({ path: '/api/project/create', method: 'POST' } as Request, res as Response, () => { nextCalled = true; });
    return { nextCalled, statusCode: res.statusCode, body: res.body };
};

describe('protect: account status', () => {
    it('lets an active user through', async () => {
        const r = await run({ userId: 'user_active', status: 'active' });
        assert.equal(r.nextCalled, true);
    });

    it('lets a signed-in user without a database record through (first-time sign-up)', async () => {
        const r = await run({ userId: 'user_new', status: null });
        assert.equal(r.nextCalled, true);
    });

    it('blocks a suspended user with 403 and a clear message', async () => {
        const r = await run({ userId: 'user_suspended', status: 'suspended' });
        assert.equal(r.nextCalled, false);
        assert.equal(r.statusCode, 403);
        assert.match(r.body.message, /suspended/i);
        assert.equal(r.body.accountStatus, 'suspended');
    });

    it('blocks deleted and unknown statuses (fails closed)', async () => {
        for (const status of ['deleted', 'banned', '']) {
            const r = await run({ userId: 'user_x', status });
            assert.equal(r.nextCalled, false, `status "${status}" must be blocked`);
            assert.equal(r.statusCode, 403);
        }
    });

    it('refuses with 503 when the status cannot be checked, instead of letting the request through', async () => {
        const r = await run({ userId: 'user_active', lookupFails: true });
        assert.equal(r.nextCalled, false);
        assert.equal(r.statusCode, 503);
    });

    it('keeps the existing 401 behaviour for signed-out users and auth errors', async () => {
        assert.equal((await run({ userId: null })).statusCode, 401);
        assert.equal((await run({ userId: undefined })).statusCode, 401);
        const thrown = await run({ authThrows: true });
        assert.equal(thrown.statusCode, 401);
        assert.equal(thrown.nextCalled, false);
    });
});
