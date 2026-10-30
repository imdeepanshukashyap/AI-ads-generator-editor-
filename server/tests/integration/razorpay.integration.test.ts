import 'dotenv/config';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import {
    createCheckoutOrder,
    isCreditablePayment,
    PaymentGatewayError,
    reconcileTransaction,
    verifyCheckoutPayment,
    type PaymentServiceDeps,
} from '../../services/paymentService.js';
import { createRazorpayGateway, getRazorpayKeyMode } from '../../services/razorpayGateway.js';
import { FakePaymentDb, signCheckout } from '../helpers/fakes.js';

/**
 * Calls the real Razorpay API in TEST mode (no money moves). The database is
 * faked. Creates a few test-mode orders each run; they are harmless and stay
 * visible in the Dashboard's test mode.
 *
 *   RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... npm run test:integration
 *
 * Optional end-to-end check of a captured payment: pay an order in test mode
 * through the app's checkout, then run with RAZORPAY_TEST_PAYMENT_ID=pay_...
 */
const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const mode = getRazorpayKeyMode(keyId);

if (mode === 'live') {
    throw new Error('Refusing to run integration tests with LIVE Razorpay keys. Use rzp_test_ keys.');
}

const skip = mode === 'test' && keySecret ? false : 'RAZORPAY_KEY_ID (rzp_test_...) and RAZORPAY_KEY_SECRET not set';
const testPaymentId = process.env.RAZORPAY_TEST_PAYMENT_ID;

describe('Razorpay test-mode API', { skip }, () => {
    let sdk: Razorpay;
    let db: FakePaymentDb;
    let deps: PaymentServiceDeps;

    before(() => {
        sdk = new Razorpay({ key_id: keyId!, key_secret: keySecret! });
    });

    const fresh = () => {
        db = new FakePaymentDb();
        db.addUser('itest_user', 20);
        deps = { db: db.asDb(), gateway: createRazorpayGateway(keyId!, keySecret!), keySecret: keySecret! };
    };

    it('creates a real order with the server-side amount, currency, receipt and notes', async (t) => {
        fresh();
        const result = await createCheckoutOrder(deps, { userId: 'itest_user', planId: 'pro' });
        assert.ok(result.ok);
        assert.match(result.orderId, /^order_/);

        const order = await sdk.orders.fetch(result.orderId);
        assert.equal(Number(order.amount), 900);
        assert.equal(order.currency, 'INR');
        assert.equal(order.receipt, result.transactionId);
        assert.equal(order.status, 'created');
        assert.equal(order.notes?.planId, 'pro');
        assert.equal(db.credits('itest_user'), 20);
        // Order ids are not secrets; this lets the run be matched in the Dashboard (Test mode → Orders).
        t.diagnostic(`Razorpay test order ${order.id}: ${order.amount} ${order.currency}, status ${order.status}`);
    });

    it('reports a new order as unpaid, so reconciliation grants nothing', async () => {
        fresh();
        const result = await createCheckoutOrder(deps, { userId: 'itest_user', planId: 'pro' });
        assert.ok(result.ok);

        const txn = db.txnByOrder(result.orderId)!;
        const { outcome } = await reconcileTransaction(deps, txn as any, { apply: true });
        assert.equal(outcome, 'still_pending');
        assert.equal(db.credits('itest_user'), 20);
    });

    it('asks Razorpay about a correctly signed but unknown payment and credits nothing', async () => {
        fresh();
        const result = await createCheckoutOrder(deps, { userId: 'itest_user', planId: 'pro' });
        assert.ok(result.ok);
        const paymentId = `pay_${crypto.randomBytes(7).toString('hex')}`;

        await assert.rejects(
            verifyCheckoutPayment(deps, {
                userId: 'itest_user',
                orderId: result.orderId,
                paymentId,
                signature: signCheckout(keySecret!, result.orderId, paymentId),
            }),
            PaymentGatewayError,
        );
        assert.equal(db.txnByOrder(result.orderId)!.status, 'pending');
        assert.equal(db.credits('itest_user'), 20);
    });

    it('fails loudly when the key secret does not belong to the key id', async () => {
        fresh();
        const mismatched = { ...deps, gateway: createRazorpayGateway(keyId!, 'not_the_matching_secret') };
        await assert.rejects(
            createCheckoutOrder(mismatched, { userId: 'itest_user', planId: 'pro' }),
            (err: unknown) => err instanceof PaymentGatewayError && err.statusCode === 401,
        );
        assert.equal(db.transactions.size, 0);
    });

    it('verifies a real test-mode payment end to end', { skip: testPaymentId ? false : 'RAZORPAY_TEST_PAYMENT_ID not set' }, async () => {
        fresh();
        const payment = await sdk.payments.fetch(testPaymentId!);
        assert.ok(payment.order_id, 'the payment must belong to an order');

        const now = new Date();
        db.transactions.set('itest_txn', {
            id: 'itest_txn',
            userId: 'itest_user',
            planId: 'pro',
            planName: 'Pro',
            amount: Number(payment.amount),
            currency: payment.currency,
            credits: 80,
            razorpayOrderId: payment.order_id,
            razorpayPaymentId: null,
            razorpaySignature: null,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
        });

        const input = {
            userId: 'itest_user',
            orderId: payment.order_id,
            paymentId: payment.id,
            signature: signCheckout(keySecret!, payment.order_id, payment.id),
        };
        const result = await verifyCheckoutPayment(deps, input);

        if (isCreditablePayment(payment as any)) {
            assert.equal(result.status, 'credited');
            assert.equal(db.credits('itest_user'), 100);
            assert.equal((await verifyCheckoutPayment(deps, input)).status, 'already_processed');
            assert.equal(db.credits('itest_user'), 100);
        } else {
            assert.notEqual(result.status, 'credited', `payment status ${payment.status} must not be credited`);
            assert.equal(db.credits('itest_user'), 20);
        }
    });
});
