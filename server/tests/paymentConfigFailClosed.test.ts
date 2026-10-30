import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';

/**
 * A half-finished switch to live mode (RAZORPAY_MODE=live, but a test key id)
 * must disable payments rather than run in the wrong mode. Placeholder values only.
 */
process.env.RAZORPAY_MODE = 'live';
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'fail_closed_test_secret_not_real';
process.env.RAZORPAY_WEBHOOK_SECRET = 'fail_closed_test_webhook_not_real';
process.env.LOG_LEVEL = 'error';

const { getPaymentConfig } = await import('../configs/razorpay.js');
const { razorpayWebhook } = await import('../controllers/paymentController.js');

let server: Server;
let url: string;

before(async () => {
    const app = express();
    app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payment/webhook`;
});

after(() => server.close());

describe('payment configuration in the wrong mode', () => {
    it('is refused at startup', () => {
        assert.equal(getPaymentConfig(), null);
    });

    it('answers 503 instead of processing payments', async () => {
        const body = JSON.stringify({ event: 'payment.captured', payload: {} });
        const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(body).digest('hex');
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
            body,
        });
        assert.equal(res.status, 503);
    });
});
