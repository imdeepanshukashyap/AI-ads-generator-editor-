import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { RazorpayPaymentEntity } from '../../services/paymentService.js';
import { getRazorpayKeyMode } from '../../services/razorpayGateway.js';
import { FakeRazorpayGateway, webhookDelivery } from '../helpers/fakes.js';

/**
 * The webhook end to end over HTTP, wired like server.ts: express.raw → controller →
 * payment service → the app's own Prisma client (configs/prisma.ts) → real PostgreSQL.
 * Razorpay API calls are faked so captured payments can be confirmed.
 *
 *   PAYMENT_TEST_DATABASE_URL=<test url> npm run test:integration
 *   (a local database without TLS needs ?sslmode=disable in the URL; configs/prisma.ts forces TLS otherwise)
 */
const databaseUrl = process.env.PAYMENT_TEST_DATABASE_URL;

if (databaseUrl && [process.env.DATABASE_URL, process.env.DIRECT_URL].includes(databaseUrl)) {
    throw new Error('PAYMENT_TEST_DATABASE_URL must not be the application database (DATABASE_URL / DIRECT_URL).');
}
if (getRazorpayKeyMode(process.env.RAZORPAY_KEY_ID) === 'live') {
    throw new Error('Refusing to run integration tests with LIVE Razorpay keys. Use rzp_test_ keys.');
}

const WEBHOOK_SECRET = 'itest_http_webhook_secret_not_real';
const run = `itest_http_${crypto.randomBytes(4).toString('hex')}`;

describe('POST /api/payment/webhook on real PostgreSQL', { skip: databaseUrl ? false : 'PAYMENT_TEST_DATABASE_URL not set' }, () => {
    let server: Server;
    let url: string;
    let prisma: PrismaClient;
    const gateway = new FakeRazorpayGateway();
    let seq = 0;

    before(async () => {
        // This file runs in its own process, so pointing the app's config at the test environment is contained.
        process.env.DATABASE_URL = databaseUrl;
        process.env.RAZORPAY_KEY_ID ||= 'rzp_test_placeholder';
        process.env.RAZORPAY_KEY_SECRET ||= 'itest_key_secret_not_real';
        process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
        process.env.LOG_LEVEL = 'error';

        ({ prisma } = await import('../../configs/prisma.js'));
        const { getPaymentConfig } = await import('../../configs/razorpay.js');
        const { razorpayWebhook } = await import('../../controllers/paymentController.js');
        getPaymentConfig()!.gateway = gateway;

        const app = express();
        app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);
        app.use(express.json());
        server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payment/webhook`;
    });

    after(async () => {
        server?.close();
        if (!prisma) return;
        await prisma.transaction.deleteMany({ where: { userId: { startsWith: run } } });
        await prisma.user.deleteMany({ where: { id: { startsWith: run } } });
        await prisma.$disconnect();
    });

    /** A user with a pending Pro order, and the captured payment Razorpay would report for it. */
    const seedOrder = async () => {
        const n = ++seq;
        const userId = `${run}_user${n}`;
        const orderId = `order_${run}_${n}`;
        await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, name: 'Integration Test', image: '' } });
        await prisma.transaction.create({
            data: { userId, planId: 'pro', planName: 'Pro', amount: 900, credits: 80, razorpayOrderId: orderId },
        });
        const payment = gateway.addPayment({ id: `pay_${run}_${n}`, order_id: orderId, amount: 900, currency: 'INR' });
        return { userId, orderId, payment };
    };

    // Bodies are ASCII JSON, so the string is byte-identical to the signed buffer.
    const post = (body: Buffer | string, signature?: string) =>
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Razorpay-Event-Id': `evt_${crypto.randomBytes(6).toString('hex')}`,
                ...(signature ? { 'X-Razorpay-Signature': signature } : {}),
            },
            body: body.toString(),
        });

    const deliver = async (event: string, payment: RazorpayPaymentEntity) => {
        const { rawBody, signature } = webhookDelivery(WEBHOOK_SECRET, event, payment);
        return (await post(rawBody, signature)).status;
    };

    const state = async (userId: string, orderId: string) => ({
        credits: (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits,
        status: (await prisma.transaction.findUniqueOrThrow({ where: { razorpayOrderId: orderId } })).status,
    });

    it('rejects unsigned, mis-signed and tampered deliveries with 400 and changes nothing', async () => {
        const { userId, orderId, payment } = await seedOrder();
        const { rawBody, signature } = webhookDelivery(WEBHOOK_SECRET, 'payment.captured', payment);

        assert.equal((await post(rawBody)).status, 400);
        assert.equal((await post(rawBody, 'f'.repeat(64))).status, 400);
        assert.equal((await post(rawBody.toString().replace('"amount":900', '"amount":9'), signature)).status, 400);
        assert.equal((await post(JSON.stringify(JSON.parse(rawBody.toString()), null, 2), signature)).status, 400, 're-serialised body');
        assert.deepEqual(await state(userId, orderId), { credits: 20, status: 'pending' });
    });

    it('credits a captured payment once, even with 5 concurrent duplicates and a following order.paid', async () => {
        const { userId, orderId, payment } = await seedOrder();

        const statuses = await Promise.all(Array.from({ length: 5 }, () => deliver('payment.captured', payment)));
        assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
        assert.equal(await deliver('order.paid', payment), 200);

        assert.deepEqual(await state(userId, orderId), { credits: 100, status: 'success' });
    });

    it('answers 500 when Razorpay cannot confirm the payment, so Razorpay retries; the retry credits once', async () => {
        const { userId, orderId, payment } = await seedOrder();

        gateway.failNextCall = new Error('ETIMEDOUT');
        assert.equal(await deliver('payment.captured', payment), 500);
        assert.deepEqual(await state(userId, orderId), { credits: 20, status: 'pending' });

        assert.equal(await deliver('payment.captured', payment), 200);
        assert.deepEqual(await state(userId, orderId), { credits: 100, status: 'success' });
    });

    it('records a failed attempt, then credits a later successful attempt on the same order', async () => {
        const { userId, orderId } = await seedOrder();
        const failed = gateway.addPayment({ order_id: orderId, amount: 900, currency: 'INR', status: 'failed' });

        assert.equal(await deliver('payment.failed', failed), 200);
        assert.deepEqual(await state(userId, orderId), { credits: 20, status: 'failed' });

        const retry = gateway.addPayment({ order_id: orderId, amount: 900, currency: 'INR' });
        assert.equal(await deliver('payment.captured', retry), 200);
        assert.equal(await deliver('payment.failed', failed), 200, 'a late failure event is acknowledged');
        assert.deepEqual(await state(userId, orderId), { credits: 100, status: 'success' });
    });

    it('closes an order refunded before crediting; a late payment.captured grants nothing', async () => {
        const { userId, orderId, payment } = await seedOrder();
        const refunded = gateway.refundPayment(payment.id);

        assert.equal(await deliver('refund.created', refunded), 200);
        assert.equal(await deliver('refund.processed', refunded), 200);
        assert.equal(await deliver('payment.captured', payment), 200);
        assert.deepEqual(await state(userId, orderId), { credits: 20, status: 'refunded' });
    });

    it('acknowledges a refund after crediting and leaves the credits for a person to review', async () => {
        const { userId, orderId, payment } = await seedOrder();
        assert.equal(await deliver('payment.captured', payment), 200);

        assert.equal(await deliver('refund.processed', gateway.refundPayment(payment.id)), 200);
        assert.deepEqual(await state(userId, orderId), { credits: 100, status: 'refunded_after_credit' });
    });

    it('acknowledges events for orders this app did not create, without writing anything', async () => {
        const foreign = { id: 'pay_FOREIGN', order_id: 'order_FOREIGN', amount: 900, currency: 'INR', status: 'captured' };
        assert.equal(await deliver('payment.captured', foreign), 200);
        assert.equal(await prisma.transaction.count({ where: { razorpayOrderId: 'order_FOREIGN' } }), 0);
    });
});
