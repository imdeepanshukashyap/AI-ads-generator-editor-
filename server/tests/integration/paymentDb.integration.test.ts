import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import {
    createCheckoutOrder,
    handleRazorpayWebhook,
    reconcileTransaction,
    verifyCheckoutPayment,
    type PaymentDb,
    type PaymentServiceDeps,
} from '../../services/paymentService.js';
import { FakeRazorpayGateway, signCheckout, webhookDelivery } from '../helpers/fakes.js';

/**
 * The credit guarantees against a real PostgreSQL database: row locking under
 * concurrent conditional updates, interactive-transaction rollback, the unique
 * order constraint and the column defaults. Razorpay is faked.
 *
 * Needs a disposable or staging database that already has the schema:
 *   DIRECT_URL=<test url> DATABASE_URL=<test url> npx prisma db push
 *   PAYMENT_TEST_DATABASE_URL=<test url> npm run test:integration
 *
 * Only touches rows it creates (ids prefixed itest_) and deletes them afterwards.
 */
const databaseUrl = process.env.PAYMENT_TEST_DATABASE_URL;

if (databaseUrl && [process.env.DATABASE_URL, process.env.DIRECT_URL].includes(databaseUrl)) {
    throw new Error('PAYMENT_TEST_DATABASE_URL must not be the application database (DATABASE_URL / DIRECT_URL).');
}

const KEY_SECRET = 'itest_key_secret_not_real';
const WEBHOOK_SECRET = 'itest_webhook_secret_not_real';
const PRO_CREDITS = 80;
const run = `itest_${crypto.randomBytes(4).toString('hex')}`;

describe('payments on real PostgreSQL', { skip: databaseUrl ? false : 'PAYMENT_TEST_DATABASE_URL not set' }, () => {
    let pool: pg.Pool;
    let prisma: PrismaClient;
    let gateway: FakeRazorpayGateway;
    let deps: PaymentServiceDeps;
    let userSeq = 0;

    before(() => {
        pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
        gateway = new FakeRazorpayGateway();
        deps = { db: prisma, gateway, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET };
    });

    after(async () => {
        if (!prisma) return;
        await prisma.transaction.deleteMany({ where: { userId: { startsWith: run } } });
        await prisma.user.deleteMany({ where: { id: { startsWith: run } } });
        await prisma.$disconnect();
        await pool.end().catch(() => undefined);
    });

    const createUser = async () => {
        const id = `${run}_user${++userSeq}`;
        await prisma.user.create({ data: { id, email: `${id}@example.test`, name: 'Integration Test', image: '' } });
        return id;
    };

    const credits = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits;
    const txnStatus = async (orderId: string) =>
        (await prisma.transaction.findUniqueOrThrow({ where: { razorpayOrderId: orderId } })).status;

    const payOrder = async (userId: string) => {
        const order = await createCheckoutOrder(deps, { userId, planId: 'pro' });
        assert.ok(order.ok);
        const payment = gateway.addPayment({ order_id: order.orderId });
        return {
            orderId: order.orderId,
            paymentId: payment.id,
            signature: signCheckout(KEY_SECRET, order.orderId, payment.id),
            payment,
        };
    };

    const verify = (userId: string, p: { orderId: string; paymentId: string; signature: string }, db: PaymentDb = prisma) =>
        verifyCheckoutPayment({ ...deps, db }, { userId, orderId: p.orderId, paymentId: p.paymentId, signature: p.signature });

    it('stores new orders as pending with the INR currency default', async () => {
        const userId = await createUser();
        const p = await payOrder(userId);
        const row = await prisma.transaction.findUniqueOrThrow({ where: { razorpayOrderId: p.orderId } });
        assert.equal(row.status, 'pending');
        assert.equal(row.currency, 'INR');
        assert.equal(row.amount, 900);

        const defaulted = await prisma.transaction.create({
            data: { userId, planId: 'pro', planName: 'Pro', amount: 900, credits: PRO_CREDITS, razorpayOrderId: `${run}_order_default` },
        });
        assert.equal(defaulted.currency, 'INR', 'column default applies to rows written by older code');
    });

    it('allows only one transaction per Razorpay order', async () => {
        const userId = await createUser();
        const p = await payOrder(userId);
        await assert.rejects(
            prisma.transaction.create({
                data: { userId, planId: 'pro', planName: 'Pro', amount: 900, credits: PRO_CREDITS, razorpayOrderId: p.orderId },
            }),
            (err: any) => err?.code === 'P2002',
        );
    });

    it('credits exactly once when 20 verification requests race', async () => {
        const userId = await createUser();
        const p = await payOrder(userId);

        const results = await Promise.all(Array.from({ length: 20 }, () => verify(userId, p)));

        assert.equal(results.filter((r) => r.status === 'credited').length, 1);
        assert.equal(results.filter((r) => r.status === 'already_processed').length, 19);
        assert.equal(await credits(userId), 20 + PRO_CREDITS);
        assert.equal(await txnStatus(p.orderId), 'success');
    });

    it('credits exactly once when verify, both webhooks and reconciliation race', async () => {
        const userId = await createUser();
        const p = await payOrder(userId);
        // Reconcile only this order, so the test never touches rows it did not create.
        const txn = await prisma.transaction.findUniqueOrThrow({ where: { razorpayOrderId: p.orderId } });

        const results = await Promise.all([
            verify(userId, p),
            handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment)),
            handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'order.paid', p.payment)),
            verify(userId, p),
            reconcileTransaction(deps, txn, { apply: true }),
        ]);

        const credited = results.filter((r: any) => r.status === 'credited' || r.outcome === 'credited');
        assert.equal(credited.length, 1, JSON.stringify(results));
        assert.equal(await credits(userId), 20 + PRO_CREDITS);
    });

    it('rolls back the status change when the credit update fails, then recovers on retry', async () => {
        const userId = await createUser();
        const p = await payOrder(userId);

        let failures = 1;
        const failingDb = {
            transaction: prisma.transaction,
            user: prisma.user,
            $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
                prisma.$transaction((tx) =>
                    fn(new Proxy(tx, {
                        get: (target, prop, receiver) =>
                            prop === 'user' && failures-- > 0
                                ? { update: async () => { throw new Error('Injected failure after the status update'); } }
                                : Reflect.get(target, prop, receiver),
                    })),
                ),
        } as unknown as PaymentDb;

        await assert.rejects(verify(userId, p, failingDb), /Injected failure/);
        const row = await prisma.transaction.findUniqueOrThrow({ where: { razorpayOrderId: p.orderId } });
        assert.equal(row.status, 'pending', 'Postgres rolled back the status change');
        assert.equal(row.razorpayPaymentId, null);
        assert.equal(await credits(userId), 20);

        assert.equal((await verify(userId, p)).status, 'credited');
        assert.equal(await credits(userId), 20 + PRO_CREDITS);
    });

    it('never leaves a refunded order credited silently when the refund races the capture', async (t) => {
        const tally = { creditedThenFlagged: 0, closedAsRefunded: 0 };

        for (let i = 0; i < 20; i++) {
            const userId = await createUser();
            const p = await payOrder(userId);
            const refundEvent = { ...p.payment, amount_refunded: 900, refund_status: 'full', status: 'refunded' };
            // Stagger the refund so both interleavings happen across rounds.
            const refundDelayMs = (i % 10) * 3;

            const [capture, refund] = await Promise.all([
                handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment)),
                new Promise((resolve) => setTimeout(resolve, refundDelayMs)).then(() =>
                    handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'refund.created', refundEvent)),
                ),
            ]);

            if ((await txnStatus(p.orderId)) === 'success') {
                assert.equal(capture.status, 'credited');
                assert.equal(refund.status, 'needs_review');
                assert.equal(await credits(userId), 20 + PRO_CREDITS);
                tally.creditedThenFlagged++;
            } else {
                assert.equal(await txnStatus(p.orderId), 'refunded');
                assert.equal(refund.status, 'marked_refunded');
                assert.equal(capture.status, 'ignored');
                assert.equal(await credits(userId), 20);
                tally.closedAsRefunded++;
            }
        }
        t.diagnostic(`race outcomes: ${JSON.stringify(tally)}`);
    });

    it('grants nothing for a capture event delivered after the refund closed the order', async () => {
        const userId = await createUser();
        const p = await payOrder(userId);
        const refunded = gateway.refundPayment(p.paymentId);

        assert.equal((await handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'refund.processed', refunded))).status, 'marked_refunded');
        assert.equal((await handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment))).status, 'ignored');
        assert.deepEqual(await verify(userId, p), { status: 'refunded' });

        assert.equal(await txnStatus(p.orderId), 'refunded');
        assert.equal(await credits(userId), 20);
    });
});
