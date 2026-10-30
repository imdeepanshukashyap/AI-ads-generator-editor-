import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCheckoutOrder,
    handleRazorpayWebhook,
    HANDLED_WEBHOOK_EVENTS,
    isCreditablePayment,
    isRefundedPayment,
    isValidCheckoutSignature,
    MAX_RECENT_PENDING_ORDERS,
    PaymentGatewayError,
    reconcilePendingTransactions,
    safeEqual,
    verifyCheckoutPayment,
    type PaymentServiceDeps,
} from '../services/paymentService.js';
import { FakePaymentDb, FakeRazorpayGateway, signCheckout, webhookDelivery } from './helpers/fakes.js';

const KEY_SECRET = 'test_key_secret_not_real';
const WEBHOOK_SECRET = 'test_webhook_secret_not_real';
const STARTING_CREDITS = 20;
const PRO_CREDITS = 80;

let db: FakePaymentDb;
let gateway: FakeRazorpayGateway;
let deps: PaymentServiceDeps;

beforeEach(() => {
    db = new FakePaymentDb();
    db.addUser('user_a', STARTING_CREDITS);
    db.addUser('user_b', STARTING_CREDITS);
    gateway = new FakeRazorpayGateway();
    deps = { db: db.asDb(), gateway, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET };
});

/** Creates a Pro order for `userId` and simulates the customer paying it. */
const payOrder = async (userId = 'user_a', paymentStatus = 'captured') => {
    const order = await createCheckoutOrder(deps, { userId, planId: 'pro' });
    assert.ok(order.ok);
    const payment = gateway.addPayment({ order_id: order.orderId, status: paymentStatus });
    return {
        orderId: order.orderId,
        paymentId: payment.id,
        signature: signCheckout(KEY_SECRET, order.orderId, payment.id),
        payment,
    };
};

const verify = (userId: string, p: { orderId: string; paymentId: string; signature: string }) =>
    verifyCheckoutPayment(deps, { userId, orderId: p.orderId, paymentId: p.paymentId, signature: p.signature });

describe('createCheckoutOrder', () => {
    it('creates the order from server-side plan data and stores a pending transaction', async () => {
        const result = await createCheckoutOrder(deps, { userId: 'user_a', planId: 'pro' });

        assert.ok(result.ok);
        assert.equal(result.amount, 900);
        assert.equal(result.currency, 'INR');
        assert.deepEqual(gateway.createOrderCalls[0].amount, 900);
        assert.equal(gateway.createOrderCalls[0].receipt, result.transactionId);

        const txn = db.txnByOrder(result.orderId)!;
        assert.equal(txn.userId, 'user_a');
        assert.equal(txn.credits, PRO_CREDITS);
        assert.equal(txn.amount, 900);
        assert.equal(txn.status, 'pending');
        assert.equal(db.credits('user_a'), STARTING_CREDITS, 'creating an order grants nothing');
    });

    it('rejects the free plan, unknown plans and prototype keys without calling Razorpay', async () => {
        for (const planId of ['starter', 'enterprise', 'constructor', '__proto__', 123, undefined]) {
            const result = await createCheckoutOrder(deps, { userId: 'user_a', planId });
            assert.equal(result.ok, false, `planId ${String(planId)} should be rejected`);
        }
        assert.equal(gateway.createOrderCalls.length, 0);
        assert.equal(db.transactions.size, 0);
    });

    it('limits how many unpaid orders a user can open', async () => {
        for (let i = 0; i < MAX_RECENT_PENDING_ORDERS; i++) {
            assert.ok((await createCheckoutOrder(deps, { userId: 'user_a', planId: 'pro' })).ok);
        }
        const blocked = await createCheckoutOrder(deps, { userId: 'user_a', planId: 'pro' });
        assert.deepEqual(blocked, { ok: false, reason: 'too_many_pending' });
        assert.ok((await createCheckoutOrder(deps, { userId: 'user_b', planId: 'pro' })).ok, 'other users are unaffected');
    });

    it('stores nothing when Razorpay order creation fails', async () => {
        gateway.failNextCall = new Error('Razorpay down');
        await assert.rejects(createCheckoutOrder(deps, { userId: 'user_a', planId: 'pro' }), PaymentGatewayError);
        assert.equal(db.transactions.size, 0);
    });
});

describe('verifyCheckoutPayment', () => {
    it('credits the transaction owner exactly the plan credits on a captured payment', async () => {
        const p = await payOrder();
        const result = await verify('user_a', p);

        assert.deepEqual(result, { status: 'credited', credits: PRO_CREDITS });
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
        const txn = db.txnByOrder(p.orderId)!;
        assert.equal(txn.status, 'success');
        assert.equal(txn.razorpayPaymentId, p.paymentId);
        assert.equal(txn.razorpaySignature, p.signature);
    });

    it('rejects an invalid signature without changing any stored state', async () => {
        const p = await payOrder();
        const result = await verify('user_a', { ...p, signature: 'f'.repeat(64) });

        assert.deepEqual(result, { status: 'invalid_signature' });
        const txn = db.txnByOrder(p.orderId)!;
        assert.equal(txn.status, 'pending');
        assert.equal(txn.razorpayPaymentId, null);
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
        assert.equal(gateway.fetchPaymentCalls, 0);
    });

    it("does not let another user claim or tamper with someone else's order", async () => {
        const p = await payOrder('user_a');

        assert.deepEqual(await verify('user_b', p), { status: 'not_found' });
        assert.deepEqual(await verify('user_b', { ...p, signature: 'bad' }), { status: 'not_found' });

        assert.equal(db.credits('user_a'), STARTING_CREDITS);
        assert.equal(db.credits('user_b'), STARTING_CREDITS);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'pending');

        assert.equal((await verify('user_a', p)).status, 'credited', 'the real owner can still verify');
    });

    it('rejects payments whose order, amount or currency do not match the stored order', async () => {
        const cases = [
            { field: 'order', patch: { order_id: 'order_SOMEONE_ELSE' } },
            { field: 'amount', patch: { amount: 100 } },
            { field: 'currency', patch: { currency: 'USD' } },
        ] as const;

        for (const { field, patch } of cases) {
            const p = await payOrder();
            Object.assign(gateway.payments.get(p.paymentId)!, patch);
            assert.deepEqual(await verify('user_a', p), { status: 'mismatch', mismatch: field });
            assert.equal(db.txnByOrder(p.orderId)!.status, 'pending');
        }
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('rejects unknown orders and malformed input', async () => {
        assert.deepEqual(
            await verifyCheckoutPayment(deps, { userId: 'user_a', orderId: 'order_UNKNOWN', paymentId: 'pay_X', signature: 'sig' }),
            { status: 'not_found' },
        );
        for (const bad of [undefined, '', 42, { $ne: null }, 'x'.repeat(500)]) {
            assert.deepEqual(
                await verifyCheckoutPayment(deps, { userId: 'user_a', orderId: bad, paymentId: 'pay_X', signature: 'sig' }),
                { status: 'invalid_request' },
            );
        }
    });

    it('treats a repeated verification as already processed and credits once', async () => {
        const p = await payOrder();
        assert.equal((await verify('user_a', p)).status, 'credited');
        assert.deepEqual(await verify('user_a', p), { status: 'already_processed', credits: PRO_CREDITS });
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('credits once when many verification requests race', async () => {
        const p = await payOrder();
        const results = await Promise.all(Array.from({ length: 10 }, () => verify('user_a', p)));

        assert.equal(results.filter((r) => r.status === 'credited').length, 1);
        assert.equal(results.filter((r) => r.status === 'already_processed').length, 9);
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('grants nothing for an authorized-but-uncaptured payment until it is captured', async () => {
        const p = await payOrder('user_a', 'authorized');
        assert.deepEqual(await verify('user_a', p), { status: 'pending', paymentStatus: 'authorized', credits: PRO_CREDITS });
        assert.equal(db.credits('user_a'), STARTING_CREDITS);

        gateway.setPaymentStatus(p.paymentId, 'captured');
        assert.equal((await verify('user_a', p)).status, 'credited');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('records a failed payment without credits, and still credits a later successful retry', async () => {
        const failed = await payOrder('user_a', 'failed');
        assert.deepEqual(await verify('user_a', failed), { status: 'rejected', paymentStatus: 'failed' });
        assert.equal(db.txnByOrder(failed.orderId)!.status, 'failed');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);

        // Customer retries in the same Checkout session: new payment on the same order.
        const retry = gateway.addPayment({ order_id: failed.orderId, status: 'captured' });
        const result = await verify('user_a', {
            orderId: failed.orderId,
            paymentId: retry.id,
            signature: signCheckout(KEY_SECRET, failed.orderId, retry.id),
        });
        assert.equal(result.status, 'credited');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('does not credit an auto-refunded (never captured) payment, and leaves the order open', async () => {
        const p = await payOrder('user_a', 'refunded'); // captured: false, as Razorpay auto-refunds report it
        assert.deepEqual(await verify('user_a', p), { status: 'refunded' });
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'pending');
    });

    it('does not credit a captured payment that was fully refunded, and closes the order', async () => {
        const p = await payOrder();
        gateway.refundPayment(p.paymentId);

        assert.deepEqual(await verify('user_a', p), { status: 'refunded' });
        assert.equal(db.txnByOrder(p.orderId)!.status, 'refunded');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);

        assert.deepEqual(await verify('user_a', p), { status: 'refunded' }, 'stays refunded on retry');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('does not credit a partially refunded payment even though its status is still captured', async () => {
        const p = await payOrder();
        const refunded = gateway.refundPayment(p.paymentId, 100);
        assert.equal(refunded.status, 'captured');

        assert.deepEqual(await verify('user_a', p), { status: 'refunded' });
        assert.equal(db.txnByOrder(p.orderId)!.status, 'refunded');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('rolls back the status change if crediting fails, and recovers on retry', async () => {
        const p = await payOrder();
        db.failUserUpdates = 1;

        await assert.rejects(verify('user_a', p), /Simulated database failure/);
        const txn = db.txnByOrder(p.orderId)!;
        assert.equal(txn.status, 'pending', 'status change rolled back with the failed credit');
        assert.equal(txn.razorpayPaymentId, null);
        assert.equal(db.credits('user_a'), STARTING_CREDITS);

        assert.equal((await verify('user_a', p)).status, 'credited');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('surfaces Razorpay outages as gateway errors without changing state', async () => {
        const p = await payOrder();
        gateway.failNextCall = new Error('ETIMEDOUT');
        await assert.rejects(verify('user_a', p), PaymentGatewayError);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'pending');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });
});

describe('handleRazorpayWebhook', () => {
    it('credits a captured payment when the browser never called verify', async () => {
        const p = await payOrder();
        const result = await handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment));

        assert.equal(result.status, 'credited');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'success');
    });

    it('credits once for repeated and concurrent deliveries of the same events', async () => {
        const p = await payOrder();
        const captured = webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment);
        const paid = webhookDelivery(WEBHOOK_SECRET, 'order.paid', p.payment);

        await handleRazorpayWebhook(deps, captured);
        await handleRazorpayWebhook(deps, captured);
        const concurrent = await Promise.all([
            handleRazorpayWebhook(deps, captured),
            handleRazorpayWebhook(deps, paid),
            handleRazorpayWebhook(deps, paid),
        ]);

        assert.ok(concurrent.every((r) => r.status === 'already_processed'));
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('credits once when the webhook and checkout verification race', async () => {
        const p = await payOrder();
        const results = await Promise.all([
            verify('user_a', p),
            handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment)),
            verify('user_a', p),
        ]);

        assert.equal(results.filter((r) => r.status === 'credited').length, 1);
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('rejects bad signatures, tampered bodies and missing secrets', async () => {
        const p = await payOrder();
        const delivery = webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment);

        assert.deepEqual(await handleRazorpayWebhook(deps, { ...delivery, signature: '0'.repeat(64) }), { status: 'invalid_signature' });
        assert.deepEqual(await handleRazorpayWebhook(deps, { ...delivery, signature: undefined }), { status: 'invalid_signature' });
        assert.deepEqual(
            await handleRazorpayWebhook(deps, { rawBody: JSON.parse(delivery.rawBody.toString()), signature: delivery.signature }),
            { status: 'invalid_signature' },
            'a re-serialised (parsed) body is not accepted',
        );

        const tampered = Buffer.from(delivery.rawBody.toString().replace('"amount":900', '"amount":1'));
        assert.deepEqual(await handleRazorpayWebhook(deps, { rawBody: tampered, signature: delivery.signature }), { status: 'invalid_signature' });

        const forged = webhookDelivery('attacker_secret', 'payment.captured', p.payment);
        assert.deepEqual(await handleRazorpayWebhook(deps, forged), { status: 'invalid_signature' });

        assert.deepEqual(await handleRazorpayWebhook({ ...deps, webhookSecret: null }, delivery), { status: 'not_configured' });
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('ignores orders it did not create and unhandled event types', async () => {
        const foreign = webhookDelivery(WEBHOOK_SECRET, 'payment.captured', {
            id: 'pay_FOREIGN', order_id: 'order_FOREIGN', amount: 900, currency: 'INR', status: 'captured',
        });
        assert.equal((await handleRazorpayWebhook(deps, foreign)).status, 'ignored');

        const p = await payOrder();
        const unhandled = webhookDelivery(WEBHOOK_SECRET, 'payment.authorized', p.payment);
        assert.equal((await handleRazorpayWebhook(deps, unhandled)).status, 'ignored');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'pending');
    });

    it('subscribes to exactly the events the runbook lists', () => {
        assert.deepEqual(
            [...HANDLED_WEBHOOK_EVENTS].sort(),
            ['order.paid', 'payment.captured', 'payment.failed', 'refund.created', 'refund.failed', 'refund.processed'],
        );
    });

    it('confirms the payment with Razorpay before crediting, and skips the call for finished orders', async () => {
        const p = await payOrder();
        const delivery = webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment);

        assert.equal((await handleRazorpayWebhook(deps, delivery)).status, 'credited');
        assert.equal(gateway.fetchPaymentCalls, 1);

        assert.equal((await handleRazorpayWebhook(deps, delivery)).status, 'already_processed');
        assert.equal(gateway.fetchPaymentCalls, 1, 'duplicates of a finished order need no API call');
    });

    it('does not credit when Razorpay reports different details than the webhook payload', async () => {
        const p = await payOrder();
        gateway.payments.get(p.paymentId)!.amount = 100;

        const result = await handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment));
        assert.equal(result.status, 'mismatch');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('leaves the order unpaid when Razorpay cannot confirm the payment, so the delivery is retried', async () => {
        const p = await payOrder();
        gateway.failNextCall = new Error('ETIMEDOUT');

        await assert.rejects(handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment)), PaymentGatewayError);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'pending');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('does not credit a webhook payment whose amount does not match the order', async () => {
        const p = await payOrder();
        const result = await handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', { ...p.payment, amount: 100 }));
        assert.equal(result.status, 'mismatch');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('marks failures, never downgrades a paid order, and credits a later capture', async () => {
        const p = await payOrder('user_a', 'failed');
        const failedEvent = webhookDelivery(WEBHOOK_SECRET, 'payment.failed', p.payment);
        assert.equal((await handleRazorpayWebhook(deps, failedEvent)).status, 'marked_failed');
        assert.equal(db.txnByOrder(p.orderId)!.status, 'failed');

        const retry = gateway.addPayment({ order_id: p.orderId, status: 'captured' });
        assert.equal((await handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, 'payment.captured', retry))).status, 'credited');

        // A late or replayed failure event must not undo the successful payment.
        assert.equal((await handleRazorpayWebhook(deps, failedEvent)).status, 'ignored');
        assert.equal(db.txnByOrder(p.orderId)!.status, 'success');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('leaves the order unpaid if the database fails, so Razorpay can retry', async () => {
        const p = await payOrder();
        const delivery = webhookDelivery(WEBHOOK_SECRET, 'payment.captured', p.payment);
        db.failUserUpdates = 1;

        await assert.rejects(handleRazorpayWebhook(deps, delivery));
        assert.equal(db.txnByOrder(p.orderId)!.status, 'pending');

        assert.equal((await handleRazorpayWebhook(deps, delivery)).status, 'credited');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });
});

describe('refunds', () => {
    const deliver = (event: string, payment: Parameters<typeof webhookDelivery>[2]) =>
        handleRazorpayWebhook(deps, webhookDelivery(WEBHOOK_SECRET, event, payment));

    it('closes an unpaid order on refund, so late capture events, verify and reconcile never credit it', async () => {
        // Captured, crediting failed or was delayed, then the payment was refunded from the Dashboard.
        const p = await payOrder();
        const refunded = gateway.refundPayment(p.paymentId);

        assert.equal((await deliver('refund.created', refunded)).status, 'marked_refunded');
        assert.equal(db.txnByOrder(p.orderId)!.status, 'refunded');

        // Stale snapshots retried after the refund, in any order.
        assert.equal((await deliver('payment.captured', p.payment)).status, 'ignored');
        assert.equal((await deliver('order.paid', p.payment)).status, 'ignored');
        assert.deepEqual(await verify('user_a', p), { status: 'refunded' });
        const later = () => new Date(Date.now() + 60 * 60 * 1000);
        assert.equal((await reconcilePendingTransactions({ ...deps, now: later }, { apply: true })).checked, 0);

        assert.equal((await deliver('refund.processed', refunded)).status, 'ignored', 'duplicate refund events are no-ops');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'refunded');
    });

    it('does not credit a stale payment.captured delivered after the payment was refunded', async () => {
        const p = await payOrder();
        gateway.refundPayment(p.paymentId); // the refund webhook has not arrived yet

        const result = await deliver('payment.captured', p.payment); // payload still says captured
        assert.equal(result.status, 'marked_refunded');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'refunded');
    });

    it('flags a refund on an already-credited order for review and does not change credits automatically', async () => {
        const p = await payOrder();
        assert.equal((await verify('user_a', p)).status, 'credited');
        const refunded = gateway.refundPayment(p.paymentId);

        const result = await deliver('refund.processed', refunded);
        assert.equal(result.status, 'needs_review');
        assert.equal(db.txnByOrder(p.orderId)!.status, 'success');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('ignores auto-refunds of uncaptured payments, and still credits a later successful attempt', async () => {
        const order = await createCheckoutOrder(deps, { userId: 'user_a', planId: 'pro' });
        assert.ok(order.ok);
        const uncaptured = gateway.addPayment({ order_id: order.orderId, status: 'authorized' });
        const autoRefunded = { ...gateway.refundPayment(uncaptured.id), captured: false };

        assert.equal((await deliver('refund.processed', autoRefunded)).status, 'ignored');
        assert.equal(db.txnByOrder(order.orderId)!.status, 'pending');

        const retry = gateway.addPayment({ order_id: order.orderId, status: 'captured' });
        assert.equal((await deliver('payment.captured', retry)).status, 'credited');
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('flags a failed refund on an order that was closed as refunded', async () => {
        const p = await payOrder();
        const refunded = gateway.refundPayment(p.paymentId);
        await deliver('refund.created', refunded);

        assert.equal((await deliver('refund.failed', refunded)).status, 'needs_review');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);

        const other = await payOrder();
        assert.equal((await deliver('refund.failed', other.payment)).status, 'ignored');
        assert.equal(db.txnByOrder(other.orderId)!.status, 'pending');
    });

    it('never ends refunded-and-credited silently when a refund races the capture webhook', async () => {
        for (let i = 0; i < 25; i++) {
            db.users.get('user_a')!.credits = STARTING_CREDITS;
            const p = await payOrder();
            const refundEvent = { ...p.payment, amount_refunded: 900, refund_status: 'full', status: 'refunded' };

            const [capture, refund] = await Promise.all([
                deliver('payment.captured', p.payment),
                deliver('refund.created', refundEvent),
            ]);

            const status = db.txnByOrder(p.orderId)!.status;
            if (status === 'success') {
                assert.equal(capture.status, 'credited');
                assert.equal(refund.status, 'needs_review', 'a refund after credit is always flagged');
                assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
            } else {
                assert.equal(status, 'refunded');
                assert.equal(refund.status, 'marked_refunded');
                assert.equal(capture.status, 'ignored');
                assert.equal(db.credits('user_a'), STARTING_CREDITS);
            }
        }
    });
});

describe('reconcilePendingTransactions', () => {
    const later = () => new Date(Date.now() + 60 * 60 * 1000); // past the in-flight grace period

    it('closes orders whose captured payment was refunded instead of crediting them', async () => {
        const p = await payOrder();
        gateway.refundPayment(p.paymentId);

        const dryRun = await reconcilePendingTransactions({ ...deps, now: later }, { apply: false });
        assert.deepEqual(dryRun.results.map((r) => r.outcome), ['would_mark_refunded']);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'pending', 'dry run writes nothing');

        const applied = await reconcilePendingTransactions({ ...deps, now: later }, { apply: true });
        assert.deepEqual(applied.results.map((r) => r.outcome), ['marked_refunded']);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'refunded');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('does not credit a partially refunded payment', async () => {
        const p = await payOrder();
        gateway.refundPayment(p.paymentId, 100);

        const summary = await reconcilePendingTransactions({ ...deps, now: later }, { apply: true });
        assert.deepEqual(summary.results.map((r) => r.outcome), ['marked_refunded']);
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('credits captured payments that were never verified, and is safe to re-run', async () => {
        const p = await payOrder();

        const dryRun = await reconcilePendingTransactions({ ...deps, now: later }, { apply: false });
        assert.equal(dryRun.results[0].outcome, 'would_credit');
        assert.equal(db.credits('user_a'), STARTING_CREDITS, 'dry run writes nothing');

        const applied = await reconcilePendingTransactions({ ...deps, now: later }, { apply: true });
        assert.deepEqual(applied.results.map((r) => r.outcome), ['credited']);
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
        assert.equal(db.txnByOrder(p.orderId)!.status, 'success');

        const rerun = await reconcilePendingTransactions({ ...deps, now: later }, { apply: true });
        assert.equal(rerun.checked, 0);
        assert.equal(db.credits('user_a'), STARTING_CREDITS + PRO_CREDITS);
    });

    it('leaves abandoned checkouts pending without credits', async () => {
        const order = await createCheckoutOrder(deps, { userId: 'user_a', planId: 'pro' });
        assert.ok(order.ok);

        const summary = await reconcilePendingTransactions({ ...deps, now: later }, { apply: true });
        assert.deepEqual(summary.results.map((r) => r.outcome), ['still_pending']);
        assert.equal(db.txnByOrder(order.orderId)!.status, 'pending');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('skips orders still inside the checkout grace period', async () => {
        await payOrder();
        const summary = await reconcilePendingTransactions(deps, { apply: true });
        assert.equal(summary.checked, 0);
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('flags captured payments that do not match the order instead of crediting them', async () => {
        const p = await payOrder();
        gateway.payments.get(p.paymentId)!.amount = 100;

        const summary = await reconcilePendingTransactions({ ...deps, now: later }, { apply: true });
        assert.deepEqual(summary.results.map((r) => r.outcome), ['mismatch']);
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });

    it('reports per-order Razorpay errors without stopping the run', async () => {
        await payOrder();
        gateway.failNextCall = new Error('Razorpay down');
        const summary = await reconcilePendingTransactions({ ...deps, now: later }, { apply: true });
        assert.equal(summary.results[0].outcome, 'error');
        assert.equal(db.credits('user_a'), STARTING_CREDITS);
    });
});

describe('signature helpers', () => {
    it('accepts the Razorpay checkout signature format and rejects others', () => {
        const sig = signCheckout(KEY_SECRET, 'order_1', 'pay_1');
        assert.equal(isValidCheckoutSignature(KEY_SECRET, 'order_1', 'pay_1', sig), true);
        assert.equal(isValidCheckoutSignature(KEY_SECRET, 'order_1', 'pay_2', sig), false);
        assert.equal(isValidCheckoutSignature('other_secret', 'order_1', 'pay_1', sig), false);
    });

    it('compares in constant time without throwing on length differences', () => {
        assert.equal(safeEqual('abc', 'abc'), true);
        assert.equal(safeEqual('abc', 'abcd'), false);
        assert.equal(safeEqual('', 'a'), false);
    });
});

describe('payment state helpers', () => {
    const base = { id: 'pay_1', order_id: 'order_1', amount: 900, currency: 'INR' };

    it('treats only captured payments with nothing refunded as creditable', () => {
        assert.equal(isCreditablePayment({ ...base, status: 'captured', amount_refunded: 0, refund_status: null }), true);
        assert.equal(isCreditablePayment({ ...base, status: 'captured' }), true, 'fields absent on older payloads');
        for (const status of ['created', 'authorized', 'failed', 'refunded']) {
            assert.equal(isCreditablePayment({ ...base, status }), false, status);
        }
        assert.equal(isCreditablePayment({ ...base, status: 'captured', amount_refunded: 1 }), false);
        assert.equal(isCreditablePayment({ ...base, status: 'captured', refund_status: 'partial' }), false);
    });

    it('recognises full and partial refunds, including the SDK typing of refund_status', () => {
        assert.equal(isRefundedPayment({ ...base, status: 'refunded' }), true);
        assert.equal(isRefundedPayment({ ...base, status: 'captured', amount_refunded: '100' }), true);
        assert.equal(isRefundedPayment({ ...base, status: 'captured', refund_status: 'full' }), true);
        assert.equal(isRefundedPayment({ ...base, status: 'captured', refund_status: 'null' }), false);
        assert.equal(isRefundedPayment({ ...base, status: 'captured', amount_refunded: null, refund_status: null }), false);
    });
});
