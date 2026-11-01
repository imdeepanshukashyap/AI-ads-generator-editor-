import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import {
    createCheckoutOrder,
    isCreditablePayment,
    reconcileTransaction,
    verifyCheckoutPayment,
    type PaymentServiceDeps,
} from '../services/paymentService.js';
import { createRazorpayGateway, getRazorpayKeyMode } from '../services/razorpayGateway.js';

/**
 * Local test-mode checkout
 *
 * Serves a minimal page on http://127.0.0.1:5055 that buys credit packs through the
 * real Razorpay Checkout in TEST mode, using the app's payment service and a
 * dedicated test database. It needs no Clerk, Google or Cloudinary configuration.
 * After a payment it repeats the verification (duplicates, concurrency, a forged
 * signature) and records every outcome in logs/test-checkout-evidence.jsonl.
 *
 *   PAYMENT_TEST_DATABASE_URL=<test db url> npm run checkout:test
 *
 * Needs RAZORPAY_KEY_ID (rzp_test_...) and RAZORPAY_KEY_SECRET, e.g. in server/.env.
 * Refuses live keys and refuses DATABASE_URL / DIRECT_URL. Never prints secrets.
 */
const PORT = Number(process.env.TEST_CHECKOUT_PORT) || 5055;
const USER_ID = 'checkout_test_user';
const EVIDENCE_FILE = path.join('logs', 'test-checkout-evidence.jsonl');

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const databaseUrl = process.env.PAYMENT_TEST_DATABASE_URL;

const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
};

if (getRazorpayKeyMode(keyId) !== 'test' || !keySecret) {
    fail('RAZORPAY_KEY_ID (rzp_test_...) and RAZORPAY_KEY_SECRET are required. Live keys are refused.');
}
if (!databaseUrl) fail('PAYMENT_TEST_DATABASE_URL is required (a dedicated test database with the schema applied).');
if ([process.env.DATABASE_URL, process.env.DIRECT_URL].includes(databaseUrl)) {
    fail('PAYMENT_TEST_DATABASE_URL must not be the application database (DATABASE_URL / DIRECT_URL).');
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const gateway = createRazorpayGateway(keyId!, keySecret!);
const deps: PaymentServiceDeps = { db: prisma, gateway, keySecret: keySecret! };

const record = (step: string, data: Record<string, unknown>) => {
    const entry = { at: new Date().toISOString(), step, ...data };
    fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
    fs.appendFileSync(EVIDENCE_FILE, JSON.stringify(entry) + '\n');
    console.log(`[${step}]`, JSON.stringify(data));
};

const credits = async () => (await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } })).credits;

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
    res.type('html').send(PAGE);
});

app.get('/state', async (_req, res) => {
    const transactions = await prisma.transaction.findMany({
        where: { userId: USER_ID },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { razorpayOrderId: true, razorpayPaymentId: true, planId: true, amount: true, credits: true, status: true, createdAt: true },
    });
    res.json({ mode: 'test', credits: await credits(), transactions });
});

app.post('/create-order', async (req, res) => {
    try {
        const result = await createCheckoutOrder(deps, { userId: USER_ID, planId: req.body?.planId });
        if (!result.ok) return res.status(400).json(result);
        record('order_created', { orderId: result.orderId, amount: result.amount, currency: result.currency, planId: req.body?.planId });
        res.json({ orderId: result.orderId, amount: result.amount, currency: result.currency, keyId });
    } catch (error: any) {
        record('order_failed', { error: error.message });
        res.status(502).json({ error: error.message });
    }
});

/** Verifies once, then re-runs it the ways a browser or attacker could. */
app.post('/verify', async (req, res) => {
    const input = {
        userId: USER_ID,
        orderId: req.body?.razorpay_order_id,
        paymentId: req.body?.razorpay_payment_id,
        signature: req.body?.razorpay_signature,
    };
    try {
        const before = await credits();
        const first = await verifyCheckoutPayment(deps, input);
        const afterFirst = await credits();
        const concurrent = await Promise.all(Array.from({ length: 10 }, () => verifyCheckoutPayment(deps, input)));
        const forged = await verifyCheckoutPayment(deps, { ...input, signature: String(input.signature).split('').reverse().join('') });
        const otherUser = await verifyCheckoutPayment(deps, { ...input, userId: 'someone_else' });
        const after = await credits();
        const payment = await gateway.fetchPayment(String(input.paymentId));

        const checks = {
            firstVerify: first.status,
            creditsAddedByFirst: afterFirst - before,
            duplicateStatuses: [...new Set(concurrent.map((r) => r.status))],
            creditsAddedByDuplicates: after - afterFirst,
            forgedSignature: forged.status,
            otherUser: otherUser.status,
            razorpayPayment: {
                status: payment.status,
                captured: payment.captured,
                amount: payment.amount,
                currency: payment.currency,
                amount_refunded: payment.amount_refunded,
                refund_status: payment.refund_status,
                creditable: isCreditablePayment(payment),
            },
        };
        record('verify', { orderId: input.orderId, paymentId: input.paymentId, ...checks });
        res.json(checks);
    } catch (error: any) {
        record('verify_error', { orderId: input.orderId, paymentId: input.paymentId, error: error.message });
        res.status(502).json({ error: error.message });
    }
});

/** Reconciles one order against Razorpay (e.g. after closing the tab, or after a Dashboard refund). */
app.post('/reconcile', async (req, res) => {
    try {
        const txn = await prisma.transaction.findUnique({ where: { razorpayOrderId: String(req.body?.orderId) } });
        if (!txn || txn.userId !== USER_ID) return res.status(404).json({ error: 'order not found' });
        const before = await credits();
        const result = await reconcileTransaction(deps, txn, { apply: true });
        const outcome = { orderId: txn.razorpayOrderId, ...result, creditsAdded: (await credits()) - before };
        record('reconcile', outcome);
        res.json(outcome);
    } catch (error: any) {
        record('reconcile_error', { error: error.message });
        res.status(502).json({ error: error.message });
    }
});

async function main() {
    await prisma.user.upsert({
        where: { id: USER_ID },
        update: {},
        create: { id: USER_ID, email: 'checkout-test@example.test', name: 'Checkout Test', image: '' },
    });
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`Test-mode checkout ready: http://127.0.0.1:${PORT}  (Razorpay TEST mode; evidence in ${EVIDENCE_FILE})`);
    });
}

main().catch((error) => fail(`Could not start: ${error.message}`));

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Razorpay test checkout</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; color: #111; background: #fafafa; }
  .badge { display: inline-block; background: #fde68a; padding: 2px 10px; border-radius: 999px; font-weight: 600; }
  button { font: inherit; padding: 8px 14px; margin: 4px 6px 4px 0; border-radius: 8px; border: 1px solid #888; background: #fff; cursor: pointer; }
  pre { background: #111; color: #e5e7eb; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; } td, th { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; }
</style></head>
<body>
<h1>Razorpay test checkout <span class="badge">TEST MODE</span></h1>
<p>No real money moves. Pay with a method from Razorpay's <em>Test Cards Details</em> docs. Credits: <strong id="credits">…</strong></p>
<p><button onclick="buy('pro')">Buy Pro (₹9 test)</button><button onclick="buy('ultra')">Buy Premium (₹29 test)</button>
<button onclick="reconcileLast()">Reconcile latest order</button><button onclick="refresh()">Refresh</button></p>
<h2>Latest orders</h2><table id="orders"></table>
<h2>Results</h2><pre id="log">Ready.</pre>
<script>
var lastOrderId = null;
function log(label, data) { var el = document.getElementById('log'); el.textContent = label + '\\n' + JSON.stringify(data, null, 2) + '\\n\\n' + el.textContent; }
function post(url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
function refresh() {
  fetch('/state').then(function (r) { return r.json(); }).then(function (s) {
    document.getElementById('credits').textContent = s.credits;
    var rows = '<tr><th>Order</th><th>Payment</th><th>Plan</th><th>Status</th></tr>';
    s.transactions.forEach(function (t) { rows += '<tr><td>' + t.razorpayOrderId + '</td><td>' + (t.razorpayPaymentId || '') + '</td><td>' + t.planId + '</td><td>' + t.status + '</td></tr>'; });
    document.getElementById('orders').innerHTML = rows;
    if (!lastOrderId && s.transactions[0]) lastOrderId = s.transactions[0].razorpayOrderId;
  });
}
function buy(planId) {
  post('/create-order', { planId: planId }).then(function (order) {
    if (!order.orderId) { log('Order failed', order); return; }
    lastOrderId = order.orderId; log('Order created', order); refresh();
    var rzp = new Razorpay({
      key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
      name: 'AdGen Studio (test)', description: planId + ' credit pack',
      handler: function (response) { log('Checkout returned; verifying…', response); post('/verify', response).then(function (r) { log('Verification checks', r); refresh(); }); },
      modal: { ondismiss: function () { log('Checkout dismissed', { orderId: order.orderId }); refresh(); } }
    });
    rzp.on('payment.failed', function (r) { log('Payment failed (you can retry in the same window)', r.error); });
    rzp.open();
  });
}
function reconcileLast() { if (!lastOrderId) { log('No order yet', {}); return; } post('/reconcile', { orderId: lastOrderId }).then(function (r) { log('Reconciliation', r); refresh(); }); }
refresh();
</script></body></html>`;
