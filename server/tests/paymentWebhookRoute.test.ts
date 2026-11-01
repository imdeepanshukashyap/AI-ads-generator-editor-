import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';

/**
 * HTTP-level check of the webhook controller, wired the same way as server.ts
 * (express.raw before express.json). Uses placeholder credentials and only
 * exercises paths that touch neither the database nor the Razorpay API.
 */
const WEBHOOK_SECRET = 'route_test_webhook_secret_not_real';

process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'route_test_key_secret_not_real';
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.LOG_LEVEL = 'error';

const { razorpayWebhook } = await import('../controllers/paymentController.js');

let server: Server;
let url: string;

before(async () => {
    const app = express();
    app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);
    app.use(express.json());
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payment/webhook`;
});

after(() => server.close());

const post = (body: string, signature?: string) =>
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Razorpay-Signature': signature } : {}) },
        body,
    });

const sign = (body: string) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

describe('POST /api/payment/webhook', () => {
    it('verifies the signature against the exact raw bytes, including whitespace', async () => {
        // Pretty-printed on purpose: re-serialising a parsed body would change the bytes.
        const body = JSON.stringify({ event: 'refund.created', payload: {} }, null, 2);
        const res = await post(body, sign(body));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { received: true });
    });

    it('rejects a missing or wrong signature with 400', async () => {
        const body = JSON.stringify({ event: 'payment.captured', payload: {} });
        assert.equal((await post(body)).status, 400);
        assert.equal((await post(body, sign(body + ' '))).status, 400);
    });
});
