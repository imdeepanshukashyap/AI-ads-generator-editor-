import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express, { type Request, type Response } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Account status, admin authorization, record retention on account deletion, the
 * Clerk user.deleted webhook, admin credit changes next to Razorpay credits, and the
 * public model library, against a real PostgreSQL database with the combined schema.
 *
 *   PAYMENT_TEST_DATABASE_URL=<disposable test db url> npm run test:integration
 *   (a local database without TLS needs ?sslmode=disable; configs/prisma.ts forces TLS otherwise)
 *
 * Only touches rows whose ids start with this run's prefix and deletes them afterwards.
 */
const databaseUrl = process.env.PAYMENT_TEST_DATABASE_URL;

if (databaseUrl && [process.env.DATABASE_URL, process.env.DIRECT_URL].includes(databaseUrl)) {
    throw new Error('PAYMENT_TEST_DATABASE_URL must not be the application database (DATABASE_URL / DIRECT_URL).');
}

const run = `itest_acct_${crypto.randomBytes(4).toString('hex')}`;
const signingKey = crypto.randomBytes(24);

const fakeRes = () => {
    const res: any = { statusCode: 200, body: undefined, locals: {} };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    return res;
};
const fakeReq = (extra: Record<string, unknown> = {}) =>
    ({ path: '/test', method: 'POST', ip: '127.0.0.1', headers: {}, get: () => 'integration-test', ...extra }) as unknown as Request;

describe('account safety on real PostgreSQL', { skip: databaseUrl ? false : 'PAYMENT_TEST_DATABASE_URL not set' }, () => {
    let prisma: PrismaClient;
    let createProtect: typeof import('../../middlewares/auth.js').createProtect;
    let findUserStatus: typeof import('../../middlewares/auth.js').findUserStatus;
    let adminMiddleware: typeof import('../../middlewares/adminAuth.js').adminMiddleware;
    let anonymizeDeletedAccount: typeof import('../../services/accountDeletionService.js').anonymizeDeletedAccount;
    let updateCredits: typeof import('../../controllers/adminController.js').updateCredits;
    let listPublishedModels: typeof import('../../controllers/modelLibraryController.js').listPublishedModels;
    let getPublishedModel: typeof import('../../controllers/modelLibraryController.js').getPublishedModel;
    let getCreditTransactions: typeof import('../../services/adminService.js').getCreditTransactions;
    let getAiMonitoring: typeof import('../../services/adminService.js').getAiMonitoring;
    let grantCreditsForPayment: typeof import('../../services/paymentService.js').grantCreditsForPayment;
    let server: Server;
    let clerkUrl: string;
    let seq = 0;

    before(async () => {
        // This file runs in its own process, so pointing the app's config at the test database is contained.
        process.env.DATABASE_URL = databaseUrl;
        process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${signingKey.toString('base64')}`;
        process.env.LOG_LEVEL = 'error';

        ({ prisma } = await import('../../configs/prisma.js'));
        ({ createProtect, findUserStatus } = await import('../../middlewares/auth.js'));
        ({ adminMiddleware } = await import('../../middlewares/adminAuth.js'));
        ({ anonymizeDeletedAccount } = await import('../../services/accountDeletionService.js'));
        ({ updateCredits } = await import('../../controllers/adminController.js'));
        ({ listPublishedModels, getPublishedModel } = await import('../../controllers/modelLibraryController.js'));
        ({ getCreditTransactions, getAiMonitoring } = await import('../../services/adminService.js'));
        ({ grantCreditsForPayment } = await import('../../services/paymentService.js'));
        const clerkWebhooks = (await import('../../controllers/clerk.js')).default;

        const app = express();
        app.post('/api/clerk', express.raw({ type: 'application/json' }), clerkWebhooks);
        server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        clerkUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/clerk`;
    });

    after(async () => {
        server?.close();
        if (!prisma) return;
        const mine = { startsWith: run };
        await prisma.modelLibraryEntry.deleteMany({ where: { createdById: mine } });
        await prisma.adminLog.deleteMany({ where: { adminId: mine } });
        await prisma.creditTransaction.deleteMany({ where: { userId: mine } });
        await prisma.transaction.deleteMany({ where: { userId: mine } });
        await prisma.project.deleteMany({ where: { userId: mine } });
        await prisma.user.deleteMany({ where: { id: mine } });
        await prisma.$disconnect();
    });

    const createUser = async (data: { role?: string; status?: string; credits?: number } = {}) => {
        const id = `${run}_user${++seq}`;
        await prisma.user.create({ data: { id, email: `${id}@example.test`, name: `Person ${seq}`, image: 'https://example.test/a.png', ...data } });
        return id;
    };

    /** A user with one of every record type that a hard delete would cascade to. */
    const seedFullAccount = async () => {
        const adminId = await createUser({ role: 'ADMIN' });
        const userId = await createUser();
        await prisma.project.create({ data: { name: 'My ad', userId, productName: 'Bottle', uploadedImages: ['https://example.test/p.png'] } });
        const txn = await prisma.transaction.create({
            data: { userId, planId: 'pro', planName: 'Pro', amount: 900, credits: 80, razorpayOrderId: `order_${run}_${seq}`, razorpayPaymentId: `pay_${run}_${seq}`, status: 'success' },
        });
        await prisma.creditTransaction.create({ data: { userId, adminId, type: 'ADD', amount: 10, balance: 30, reason: 'Goodwill credit' } });
        await prisma.adminLog.create({ data: { adminId, action: 'CREDITS_ADDED', targetType: 'USER', targetId: userId, description: 'Goodwill credit' } });
        const model = await prisma.modelLibraryEntry.create({
            data: { name: `${run} model ${seq}`, imageUrl: 'https://example.test/m.png', imagePublicId: `m_${seq}`, isPublished: true, createdById: adminId },
        });
        return { adminId, userId, txnId: txn.id, modelId: model.id };
    };

    const countsFor = async (s: { adminId: string; userId: string; txnId: string; modelId: string }) => ({
        transactions: await prisma.transaction.count({ where: { id: s.txnId } }),
        creditHistory: await prisma.creditTransaction.count({ where: { userId: s.userId } }),
        adminLogs: await prisma.adminLog.count({ where: { adminId: s.adminId } }),
        models: await prisma.modelLibraryEntry.count({ where: { id: s.modelId } }),
        projects: await prisma.project.count({ where: { userId: s.userId } }),
    });

    describe('protect with real account lookups', () => {
        const check = async (userId: string) => {
            const res = fakeRes();
            let nextCalled = false;
            await createProtect({ getUserId: () => userId, findUserStatus })(fakeReq(), res, () => { nextCalled = true; });
            return { nextCalled, statusCode: res.statusCode };
        };

        it('allows active users and users without a record yet; blocks suspended and deleted users', async () => {
            assert.equal((await check(await createUser())).nextCalled, true, 'default status is active');
            assert.equal((await check(`${run}_not_created`)).nextCalled, true);
            assert.deepEqual(await check(await createUser({ status: 'suspended' })), { nextCalled: false, statusCode: 403 });
            assert.deepEqual(await check(await createUser({ status: 'deleted' })), { nextCalled: false, statusCode: 403 });
        });
    });

    describe('admin authorization (adminMiddleware)', () => {
        const check = async (userId: string) => {
            const res = fakeRes();
            res.locals.authUserId = userId;
            let nextCalled = false;
            await adminMiddleware(fakeReq(), res, () => { nextCalled = true; });
            return { nextCalled, statusCode: res.statusCode };
        };

        it('allows only active ADMIN accounts', async () => {
            assert.equal((await check(await createUser({ role: 'ADMIN' }))).nextCalled, true);
            assert.deepEqual(await check(await createUser({ role: 'ADMIN', status: 'suspended' })), { nextCalled: false, statusCode: 403 });
            assert.deepEqual(await check(await createUser({ role: 'ADMIN', status: 'deleted' })), { nextCalled: false, statusCode: 403 });
            assert.deepEqual(await check(await createUser()), { nextCalled: false, statusCode: 403 });
            assert.deepEqual(await check(`${run}_not_created`), { nextCalled: false, statusCode: 403 });
        });
    });

    describe('account deletion keeps financial and audit records', () => {
        it('anonymizes the user, deletes only their projects, and keeps payments, credit history, admin logs and models', async () => {
            const s = await seedFullAccount();
            const result = await anonymizeDeletedAccount(prisma, s.userId);
            assert.deepEqual(result, { found: true, projectsDeleted: 1 });

            const user = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
            assert.equal(user.status, 'deleted');
            assert.equal(user.name, 'Deleted user');
            assert.equal(user.image, '');
            assert.match(user.email, /^deleted-user-.*@deleted\.invalid$/);
            assert.deepEqual(await countsFor(s), { transactions: 1, creditHistory: 1, adminLogs: 1, models: 1, projects: 0 });
        });

        it('keeps an admin’s audit logs and published models when the admin account is deleted', async () => {
            const s = await seedFullAccount();
            await anonymizeDeletedAccount(prisma, s.adminId);
            const counts = await countsFor(s);
            assert.equal(counts.adminLogs, 1);
            assert.equal(counts.models, 1);
            assert.equal((await prisma.modelLibraryEntry.findUniqueOrThrow({ where: { id: s.modelId } })).isPublished, true);
            assert.equal((await prisma.creditTransaction.findFirstOrThrow({ where: { userId: s.userId } })).adminId, s.adminId);
        });
    });

    describe('Clerk user.deleted webhook', () => {
        const signed = (body: string, key = signingKey) => {
            const id = `msg_${crypto.randomBytes(8).toString('hex')}`;
            const timestamp = String(Math.floor(Date.now() / 1000));
            const signature = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
            return { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` };
        };
        const event = (userId: string) => JSON.stringify({ object: 'event', type: 'user.deleted', data: { id: userId, deleted: true, object: 'user' } });

        it('anonymizes the account and keeps its payment records', async () => {
            const s = await seedFullAccount();
            const body = event(s.userId);
            const res = await fetch(clerkUrl, { method: 'POST', headers: signed(body), body });
            assert.equal(res.status, 200);

            assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).status, 'deleted');
            assert.deepEqual(await countsFor(s), { transactions: 1, creditHistory: 1, adminLogs: 1, models: 1, projects: 0 });

            const repeat = await fetch(clerkUrl, { method: 'POST', headers: signed(body), body });
            assert.equal(repeat.status, 200, 'a redelivered event is harmless');
        });

        it('rejects a badly signed delivery and changes nothing', async () => {
            const s = await seedFullAccount();
            const body = event(s.userId);
            const res = await fetch(clerkUrl, { method: 'POST', headers: signed(body, crypto.randomBytes(24)), body });
            assert.ok(res.status >= 400);
            assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).status, 'active');
            assert.equal((await countsFor(s)).projects, 1);
        });

        it('acknowledges deletion of a user that was never created', async () => {
            const body = event(`${run}_never_created`);
            assert.equal((await fetch(clerkUrl, { method: 'POST', headers: signed(body), body })).status, 200);
        });
    });

    describe('admin credit changes next to Razorpay credits', () => {
        const adjust = async (adminId: string, userId: string, body: Record<string, unknown>) => {
            const res = fakeRes();
            res.locals.authUserId = adminId;
            await updateCredits(fakeReq({ params: { id: userId }, body }), res, () => undefined);
            return res;
        };

        it('records the change with credit history and an audit log', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const userId = await createUser();
            const res = await adjust(adminId, userId, { amount: 15, operation: 'ADD', reason: 'Support goodwill' });
            assert.equal(res.statusCode, 200);
            assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 35);
            assert.equal(await prisma.creditTransaction.count({ where: { userId, adminId, type: 'ADD', amount: 15, balance: 35 } }), 1);
            assert.equal(await prisma.adminLog.count({ where: { adminId, targetId: userId, action: 'CREDITS_ADDED' } }), 1);

            const tooMuch = await adjust(adminId, userId, { amount: 1000, operation: 'REMOVE', reason: 'Correction' });
            assert.equal(tooMuch.statusCode, 409);
            assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 35);
        });

        it('does not lose either update when an admin credit races a Razorpay credit', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const userId = await createUser();
            const txn = await prisma.transaction.create({
                data: { userId, planId: 'pro', planName: 'Pro', amount: 900, credits: 80, razorpayOrderId: `order_${run}_race` },
            });
            await Promise.all([
                grantCreditsForPayment(prisma, txn, { id: `pay_${run}_race` }),
                adjust(adminId, userId, { amount: 50, operation: 'ADD', reason: 'Concurrent goodwill' }),
            ]);
            assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 20 + 80 + 50);
        });

        it('lists Razorpay purchases in the admin credit history', async () => {
            const s = await seedFullAccount();
            const { data } = await getCreditTransactions(1, 50, s.userId);
            const purchase = data.find((row: any) => row.id === s.txnId) as any;
            assert.ok(purchase, 'purchase row present');
            assert.equal(purchase.moneyPaid, 900);
            assert.equal(purchase.status, 'success');
        });

        const balanceOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits;

        it('lets only as many concurrent removals succeed as the balance covers', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const userId = await createUser({ credits: 100 });
            const results = await Promise.all(Array.from({ length: 5 }, () => adjust(adminId, userId, { amount: 30, operation: 'REMOVE', reason: 'Concurrent correction' })));

            assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 200, 200, 409, 409]);
            assert.equal(await balanceOf(userId), 10);
            const history = await prisma.creditTransaction.findMany({ where: { userId, type: 'REMOVE' }, select: { balance: true } });
            assert.deepEqual(history.map((h) => h.balance).sort((a, b) => b - a), [70, 40, 10]);
            assert.equal(await prisma.adminLog.count({ where: { adminId, targetId: userId, action: 'CREDITS_REMOVED' } }), 3);
        });

        it('never goes negative when concurrent removals and additions interleave', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const userId = await createUser({ credits: 100 });
            const removals = Array.from({ length: 8 }, () => adjust(adminId, userId, { amount: 25, operation: 'REMOVE', reason: 'Concurrent correction' }));
            const additions = Array.from({ length: 2 }, () => adjust(adminId, userId, { amount: 10, operation: 'ADD', reason: 'Concurrent goodwill' }));
            const [removed, added] = await Promise.all([Promise.all(removals), Promise.all(additions)]);

            // 120 credits in total cover exactly four removals of 25, whatever the interleaving.
            assert.deepEqual(removed.map((r) => r.statusCode).sort(), [200, 200, 200, 200, 409, 409, 409, 409]);
            assert.deepEqual(added.map((r) => r.statusCode), [200, 200]);
            assert.equal(await balanceOf(userId), 20);
            const balances = (await prisma.creditTransaction.findMany({ where: { userId }, select: { balance: true } })).map((h) => h.balance);
            assert.equal(balances.length, 6);
            assert.ok(balances.every((b) => b >= 0), `recorded balances ${balances}`);
        });

        it('never goes negative when a removal races a Razorpay credit', async (t) => {
            const adminId = await createUser({ role: 'ADMIN' });
            const tally = { removedAfterCredit: 0, refusedBeforeCredit: 0 };
            for (let i = 0; i < 10; i++) {
                const userId = await createUser();
                const txn = await prisma.transaction.create({
                    data: { userId, planId: 'pro', planName: 'Pro', amount: 900, credits: 80, razorpayOrderId: `order_${run}_rm_${i}` },
                });
                const [, res] = await Promise.all([
                    grantCreditsForPayment(prisma, txn, { id: `pay_${run}_rm_${i}` }),
                    // Stagger the removal so both orders happen across rounds.
                    new Promise((resolve) => setTimeout(resolve, (i % 5) * 2)).then(() =>
                        adjust(adminId, userId, { amount: 90, operation: 'REMOVE', reason: 'Correction during purchase' })),
                ]);
                // 20 + 80 = 100: the removal either saw the purchase (10 left) or was refused before it (100 left).
                if (res.statusCode === 200) {
                    assert.equal(await balanceOf(userId), 10);
                    tally.removedAfterCredit++;
                } else {
                    assert.equal(res.statusCode, 409);
                    assert.equal(await balanceOf(userId), 100);
                    tally.refusedBeforeCredit++;
                }
            }
            t.diagnostic(`race outcomes: ${JSON.stringify(tally)}`);
        });

        it('returns 404 for an unknown user and records nothing', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const res = await adjust(adminId, `${run}_missing`, { amount: 5, operation: 'ADD', reason: 'Goodwill' });
            assert.equal(res.statusCode, 404);
            assert.equal(await prisma.adminLog.count({ where: { adminId } }), 0);
        });
    });

    describe('admin credit history', () => {
        /** One purchase per payment status (one in USD), and one credit-history row per type. */
        const seedHistory = async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const userId = await createUser();
            const purchase = (status: string, currency = 'INR', amount = 900) => prisma.transaction.create({
                data: { userId, planId: 'pro', planName: 'Pro', amount, currency, credits: 80, razorpayOrderId: `order_${run}_${++seq}`, status },
            });
            const purchases = {
                success: await purchase('success'),
                usd: await purchase('success', 'USD', 1500),
                pending: await purchase('pending'),
                failed: await purchase('failed'),
                refunded: await purchase('refunded'),
                refundedAfterCredit: await purchase('refunded_after_credit'),
            };
            for (const type of ['ADD', 'REMOVE', 'GENERATION_USAGE', 'REFUND']) {
                await prisma.creditTransaction.create({ data: { userId, adminId, type, amount: 5, balance: 20, reason: `${type} entry` } });
            }
            return { userId, purchases };
        };
        const rows = async (userId: string, type?: string) => (await getCreditTransactions(1, 100, userId, type)) as { total: number; data: any[] };
        const shape = (row: any) => ({ type: row.type, amount: row.amount, moneyPaid: row.moneyPaid, currency: row.currency });

        it('lists every purchase with its status; only captured payments are credit additions', async () => {
            const { userId, purchases } = await seedHistory();
            const { total, data } = await rows(userId);
            assert.equal(total, 10);
            const row = (id: string) => data.find((r) => r.id === id);

            assert.deepEqual(shape(row(purchases.success.id)), { type: 'ADD', amount: '80 credits · ₹9.00', moneyPaid: 900, currency: 'INR' });
            assert.deepEqual(shape(row(purchases.usd.id)), { type: 'ADD', amount: '80 credits · $15.00', moneyPaid: 1500, currency: 'USD' });
            for (const status of ['pending', 'failed', 'refunded'] as const) {
                assert.deepEqual(shape(row(purchases[status].id)), { type: `PAYMENT_${status.toUpperCase()}`, amount: '₹9.00 · no credits added', moneyPaid: 0, currency: 'INR' });
            }
            const flagged = row(purchases.refundedAfterCredit.id);
            assert.deepEqual(shape(flagged), { type: 'ADD', amount: '80 credits · ₹9.00 · payment refunded after credits were added — review', moneyPaid: null, currency: 'INR' });
            assert.equal(flagged.needsReview, true);
            assert.equal(data.filter((r) => r.needsReview).length, 1, 'only the refunded-after-credit purchase is flagged');
        });

        it('shows only admin additions and credited purchases for the ADD filter', async () => {
            const { userId, purchases } = await seedHistory();
            const { total, data } = await rows(userId, 'ADD');
            assert.equal(total, 4);
            assert.ok(data.every((r) => r.type === 'ADD'));
            assert.deepEqual(
                data.filter((r) => 'moneyPaid' in r).map((r) => r.id).sort(),
                [purchases.success.id, purchases.usd.id, purchases.refundedAfterCredit.id].sort(),
            );
        });

        it('shows only credit-history rows of that type for the REMOVE, GENERATION_USAGE and REFUND filters', async () => {
            const { userId } = await seedHistory();
            for (const type of ['REMOVE', 'GENERATION_USAGE', 'REFUND']) {
                const { total, data } = await rows(userId, type);
                assert.equal(total, 1, type);
                assert.equal(data[0].type, type);
                assert.ok(!('moneyPaid' in data[0]), `${type} lists no purchases`);
            }
        });
    });

    describe('public model library', () => {
        it('lists and returns only published models', async () => {
            const adminId = await createUser({ role: 'ADMIN' });
            const visible = await prisma.modelLibraryEntry.create({ data: { name: `${run} visible`, imageUrl: 'https://example.test/v.png', imagePublicId: 'v', isPublished: true, createdById: adminId } });
            const hidden = await prisma.modelLibraryEntry.create({ data: { name: `${run} hidden`, imageUrl: 'https://example.test/h.png', imagePublicId: 'h', isPublished: false, createdById: adminId } });

            const list = fakeRes();
            await listPublishedModels(fakeReq({ query: { search: run, limit: '100' } }), list as Response, (e?: unknown) => { if (e) throw e; });
            const ids = (list.body.data as Array<{ id: string }>).map((m) => m.id);
            assert.ok(ids.includes(visible.id));
            assert.ok(!ids.includes(hidden.id));

            const one = fakeRes();
            await getPublishedModel(fakeReq({ params: { id: hidden.id } }), one as Response, () => undefined);
            assert.equal(one.statusCode, 404);
            const shown = fakeRes();
            await getPublishedModel(fakeReq({ params: { id: visible.id } }), shown as Response, () => undefined);
            assert.equal(shown.body.data.id, visible.id);
        });
    });

    describe('admin AI monitoring', () => {
        it('reports the service from the same API keys generation uses', async () => {
            const saved = { key: process.env.GOOGLE_CLOUD_API_KEY, key1: process.env.GOOGLE_CLOUD_API_KEY1 };
            try {
                delete process.env.GOOGLE_CLOUD_API_KEY;
                process.env.GOOGLE_CLOUD_API_KEY1 = 'test-key-1';
                const healthy = await getAiMonitoring();
                assert.equal(healthy.service, 'Healthy', 'production configures GOOGLE_CLOUD_API_KEY1 only');
                assert.equal(healthy.provider, 'Google Gemini');

                delete process.env.GOOGLE_CLOUD_API_KEY1;
                assert.equal((await getAiMonitoring()).service, 'Down');
            } finally {
                for (const [name, value] of [['GOOGLE_CLOUD_API_KEY', saved.key], ['GOOGLE_CLOUD_API_KEY1', saved.key1]] as const) {
                    if (value === undefined) delete process.env[name];
                    else process.env[name] = value;
                }
            }
        });
    });
});
