import crypto from 'crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Payment Service
 *
 * Razorpay order creation, checkout verification, webhook handling and
 * reconciliation. All credit allocation goes through `grantCreditsForPayment`,
 * which moves a Transaction out of pending/failed with a conditional UPDATE
 * inside a database transaction — so credits are granted at most once even when
 * checkout verification, webhooks and reconciliation race each other.
 *
 * Dependencies are injected so this module can be tested without a database,
 * Razorpay credentials or network access.
 */

// ─── Plans ───────────────────────────────────────────────────────────────────
// Server-side source of truth for what a purchase costs and what it grants.
// Display prices live in client/src/assets/dummy-data.tsx (plansData) and must
// be kept in sync with these amounts.
export const PAYMENT_CURRENCY = 'INR';

export const PURCHASABLE_PLANS = {
    pro: { name: 'Pro', price: 900, credits: 80 },          // ₹9 = 900 paise
    ultra: { name: 'Premium', price: 2900, credits: 240 },  // ₹29 = 2900 paise
} as const;

export type PlanId = keyof typeof PURCHASABLE_PLANS;

// The free plan is granted at sign-up and is never sold through Razorpay.
export const FREE_PLAN_ID = 'starter';

export const TRANSACTION_STATUS = {
    PENDING: 'pending',
    SUCCESS: 'success',   // credits granted
    FAILED: 'failed',     // last attempt failed; a later capture on the same order can still be credited
    REFUNDED: 'refunded', // payment refunded before credits were granted; never credited
    REFUNDED_AFTER_CREDIT: 'refunded_after_credit', // credits granted, then the payment was refunded (fully or partly); for review
} as const;

/** Orders whose credits were granted; nothing may credit them again. */
export const CREDITED_STATUSES: string[] = [TRANSACTION_STATUS.SUCCESS, TRANSACTION_STATUS.REFUNDED_AFTER_CREDIT];

// Abuse guard: maximum unpaid checkout orders a user may open per window.
export const MAX_RECENT_PENDING_ORDERS = 10;
export const PENDING_ORDER_WINDOW_MS = 15 * 60 * 1000;

const MAX_ID_LENGTH = 100;

// ─── Types ───────────────────────────────────────────────────────────────────
export type PaymentDb = Pick<PrismaClient, 'transaction' | 'user' | '$transaction'>;

type TransactionRecord = NonNullable<Awaited<ReturnType<PaymentDb['transaction']['findUnique']>>>;

/** Subset of the Razorpay payment entity this service relies on. */
export interface RazorpayPaymentEntity {
    id: string;
    order_id?: string | null;
    amount: number | string;
    currency: string;
    status: string; // created | authorized | captured | refunded | failed
    captured?: boolean;
    amount_refunded?: number | string | null;
    refund_status?: string | null; // null | partial | full
}

export interface RazorpayOrderEntity {
    id: string;
    amount: number | string;
    currency: string;
}

export interface RazorpayGateway {
    createOrder(params: {
        amount: number;
        currency: string;
        receipt: string;
        notes: Record<string, string>;
    }): Promise<RazorpayOrderEntity>;
    fetchPayment(paymentId: string): Promise<RazorpayPaymentEntity>;
    fetchOrderPayments(orderId: string): Promise<RazorpayPaymentEntity[]>;
}

export interface PaymentLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

export interface PaymentServiceDeps {
    db: PaymentDb;
    gateway: RazorpayGateway;
    keySecret: string;
    webhookSecret?: string | null;
    logger?: PaymentLogger;
    now?: () => Date;
}

/** Raised when Razorpay cannot be reached or rejects an API call. */
export class PaymentGatewayError extends Error {
    constructor(message: string, readonly cause?: unknown, readonly statusCode?: number) {
        super(message);
        this.name = 'PaymentGatewayError';
    }
}

const callGateway = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
    try {
        return await fn();
    } catch (err: any) {
        const detail = err?.error?.description || err?.message || 'unknown error';
        const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : undefined;
        // A key id and secret from different modes (or accounts) fail here, loudly.
        const hint = statusCode === 401
            ? ' (check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are a matching pair from the same mode)'
            : '';
        throw new PaymentGatewayError(`Razorpay ${operation} failed: ${detail}${hint}`, err, statusCode);
    }
};

const isPlanId = (planId: unknown): planId is PlanId =>
    typeof planId === 'string' && Object.prototype.hasOwnProperty.call(PURCHASABLE_PLANS, planId);

const isId = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

// ─── Signatures ──────────────────────────────────────────────────────────────
const hmacSha256Hex = (secret: string, payload: string | Buffer) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex');

/** Constant-time string comparison that tolerates different lengths. */
export const safeEqual = (a: string, b: string): boolean => {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/** Checkout signature: HMAC-SHA256(`${order_id}|${payment_id}`, key secret). */
export const isValidCheckoutSignature = (keySecret: string, orderId: string, paymentId: string, signature: string) =>
    safeEqual(hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature);

/** Webhook signature: HMAC-SHA256(raw request body, webhook secret). */
export const isValidWebhookSignature = (webhookSecret: string, rawBody: Buffer, signature: string) =>
    safeEqual(hmacSha256Hex(webhookSecret, rawBody), signature);

// ─── State transitions ───────────────────────────────────────────────────────
export type PaymentMismatch = 'order' | 'amount' | 'currency';

/** Compares a Razorpay payment against the order we created server-side. */
export const findPaymentMismatch = (txn: TransactionRecord, payment: RazorpayPaymentEntity): PaymentMismatch | null => {
    if (payment.order_id !== txn.razorpayOrderId) return 'order';
    if (Number(payment.amount) !== txn.amount) return 'amount';
    if (payment.currency !== txn.currency) return 'currency';
    return null;
};

/**
 * True once any part of the payment has been refunded. A full refund changes
 * the status to "refunded"; a partial refund leaves it "captured" and only
 * shows in amount_refunded / refund_status.
 */
export const isRefundedPayment = (payment: RazorpayPaymentEntity): boolean =>
    payment.status === 'refunded' ||
    Number(payment.amount_refunded ?? 0) > 0 ||
    // The API sends JSON null; the SDK's typings spell it as the string 'null'.
    (payment.refund_status != null && payment.refund_status !== 'null');

/** Only a captured payment with nothing refunded grants credits. */
export const isCreditablePayment = (payment: RazorpayPaymentEntity): boolean =>
    payment.status === 'captured' && !isRefundedPayment(payment);

export type GrantOutcome = 'credited' | 'already_processed' | 'refunded';

/**
 * Atomically marks the transaction successful and grants its credits to the
 * transaction owner. The conditional updateMany is the idempotency guard: under
 * concurrency only one caller can move the row out of pending/failed, and the
 * credit increment commits or rolls back together with that status change.
 * A transaction closed as refunded is never credited.
 */
export const grantCreditsForPayment = async (
    db: PaymentDb,
    txn: TransactionRecord,
    payment: { id: string; signature?: string | null },
): Promise<GrantOutcome> =>
    db.$transaction(async (tx) => {
        const { count } = await tx.transaction.updateMany({
            where: {
                id: txn.id,
                status: { in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.FAILED] },
            },
            data: {
                status: TRANSACTION_STATUS.SUCCESS,
                razorpayPaymentId: payment.id,
                ...(payment.signature ? { razorpaySignature: payment.signature } : {}),
            },
        });

        if (count === 0) {
            // Report why, so a caller never tells a customer "credits added" for a refunded order.
            const current = await tx.transaction.findUnique({ where: { id: txn.id }, select: { status: true } });
            return current?.status === TRANSACTION_STATUS.REFUNDED ? 'refunded' : 'already_processed';
        }

        await tx.user.update({
            where: { id: txn.userId },
            data: { credits: { increment: txn.credits } },
        });

        return 'credited';
    });

/** Records a failed payment attempt without ever downgrading a successful order. */
const markPaymentFailed = async (db: PaymentDb, txn: TransactionRecord, paymentId: string) => {
    const { count } = await db.transaction.updateMany({
        where: {
            id: txn.id,
            status: { in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.FAILED] },
        },
        data: { status: TRANSACTION_STATUS.FAILED, razorpayPaymentId: paymentId },
    });
    return count > 0;
};

/**
 * Closes an unpaid order whose captured payment was refunded, so no late or
 * retried event can credit it. Never touches an order whose credits were granted.
 */
const markPaymentRefunded = async (db: PaymentDb, txn: TransactionRecord, paymentId: string) => {
    const { count } = await db.transaction.updateMany({
        where: {
            id: txn.id,
            status: { in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.FAILED] },
        },
        data: { status: TRANSACTION_STATUS.REFUNDED, razorpayPaymentId: paymentId },
    });
    return count > 0;
};

/**
 * Marks a credited order whose payment was then refunded, so it stands out for review.
 * Credits are not taken back automatically. False when it was not a plain credited
 * order, including when it was already flagged by an earlier refund event.
 */
const flagRefundAfterCredit = async (db: PaymentDb, txn: TransactionRecord) => {
    const { count } = await db.transaction.updateMany({
        where: { id: txn.id, status: TRANSACTION_STATUS.SUCCESS },
        data: { status: TRANSACTION_STATUS.REFUNDED_AFTER_CREDIT },
    });
    return count > 0;
};

// ─── Create order ────────────────────────────────────────────────────────────
export type CreateOrderResult =
    | { ok: true; orderId: string; amount: number; currency: string; transactionId: string }
    | { ok: false; reason: 'invalid_plan' | 'free_plan' | 'too_many_pending' };

/**
 * Creates a Razorpay order and a pending Transaction for the given plan.
 * Only `planId` comes from the client; amount, currency and credits come from
 * PURCHASABLE_PLANS.
 */
export const createCheckoutOrder = async (
    deps: PaymentServiceDeps,
    input: { userId: string; planId: unknown },
): Promise<CreateOrderResult> => {
    if (input.planId === FREE_PLAN_ID) return { ok: false, reason: 'free_plan' };
    if (!isPlanId(input.planId)) return { ok: false, reason: 'invalid_plan' };

    const planId = input.planId;
    const plan = PURCHASABLE_PLANS[planId];
    const now = deps.now?.() ?? new Date();

    const recentPending = await deps.db.transaction.count({
        where: {
            userId: input.userId,
            status: TRANSACTION_STATUS.PENDING,
            createdAt: { gte: new Date(now.getTime() - PENDING_ORDER_WINDOW_MS) },
        },
    });
    if (recentPending >= MAX_RECENT_PENDING_ORDERS) return { ok: false, reason: 'too_many_pending' };

    // Our Transaction id doubles as the Razorpay receipt so the two records can
    // be matched from either dashboard (a UUID is 36 chars; Razorpay allows 40).
    const transactionId = crypto.randomUUID();

    const order = await callGateway('order creation', () =>
        deps.gateway.createOrder({
            amount: plan.price,
            currency: PAYMENT_CURRENCY,
            receipt: transactionId,
            notes: { userId: input.userId, planId, credits: String(plan.credits), transactionId },
        }),
    );

    if (Number(order.amount) !== plan.price || order.currency !== PAYMENT_CURRENCY) {
        throw new PaymentGatewayError(`Razorpay order ${order.id} does not match the requested amount/currency`);
    }

    await deps.db.transaction.create({
        data: {
            id: transactionId,
            userId: input.userId,
            planId,
            planName: plan.name,
            amount: plan.price,
            currency: PAYMENT_CURRENCY,
            credits: plan.credits,
            razorpayOrderId: order.id,
            status: TRANSACTION_STATUS.PENDING,
        },
    });

    return { ok: true, orderId: order.id, amount: plan.price, currency: PAYMENT_CURRENCY, transactionId };
};

// ─── Checkout verification ───────────────────────────────────────────────────
export type VerifyResult =
    | { status: 'invalid_request' }
    | { status: 'not_found' }
    | { status: 'invalid_signature' }
    | { status: 'mismatch'; mismatch: PaymentMismatch }
    | { status: 'pending'; paymentStatus: string; credits: number }
    | { status: 'rejected'; paymentStatus: string }
    | { status: 'refunded' }
    | { status: 'credited' | 'already_processed'; credits: number };

/**
 * Verifies a checkout result reported by the browser. Nothing the client sends
 * decides the outcome: the order must belong to the caller, the signature must
 * match, and Razorpay must confirm the payment is captured for this order's
 * amount and currency. Credits always go to the transaction owner.
 */
export const verifyCheckoutPayment = async (
    deps: PaymentServiceDeps,
    input: { userId: string; orderId: unknown; paymentId: unknown; signature: unknown },
): Promise<VerifyResult> => {
    const { orderId, paymentId, signature } = input;
    if (!isId(orderId) || !isId(paymentId) || !isId(signature)) return { status: 'invalid_request' };

    const txn = await deps.db.transaction.findUnique({ where: { razorpayOrderId: orderId } });

    // Same response for "missing" and "someone else's order" so order IDs can't be probed.
    if (!txn || txn.userId !== input.userId) return { status: 'not_found' };

    // Signed against the order id we stored, not the one the browser reported.
    // An invalid signature never changes stored state.
    if (!isValidCheckoutSignature(deps.keySecret, txn.razorpayOrderId, paymentId, signature)) {
        return { status: 'invalid_signature' };
    }

    // Shortcuts only; the conditional update in grantCreditsForPayment is the real guard.
    if (CREDITED_STATUSES.includes(txn.status)) {
        return { status: 'already_processed', credits: txn.credits };
    }
    if (txn.status === TRANSACTION_STATUS.REFUNDED) return { status: 'refunded' };

    const payment = await callGateway('payment fetch', () => deps.gateway.fetchPayment(paymentId));

    const mismatch = findPaymentMismatch(txn, payment);
    if (mismatch) return { status: 'mismatch', mismatch };

    if (isRefundedPayment(payment)) {
        if (payment.captured !== false) await markPaymentRefunded(deps.db, txn, paymentId);
        return { status: 'refunded' };
    }

    if (isCreditablePayment(payment)) {
        const outcome = await grantCreditsForPayment(deps.db, txn, { id: paymentId, signature });
        return outcome === 'refunded' ? { status: 'refunded' } : { status: outcome, credits: txn.credits };
    }

    // Authorized but not yet captured: credits follow via webhook or reconciliation.
    if (payment.status === 'authorized' || payment.status === 'created') {
        return { status: 'pending', paymentStatus: payment.status, credits: txn.credits };
    }

    if (payment.status === 'failed') await markPaymentFailed(deps.db, txn, paymentId);
    return { status: 'rejected', paymentStatus: payment.status };
};

// ─── Webhook ─────────────────────────────────────────────────────────────────
const CREDIT_EVENTS = new Set(['payment.captured', 'order.paid']);
const FAILURE_EVENT = 'payment.failed';
const REFUND_EVENTS = new Set(['refund.created', 'refund.processed']);
const REFUND_FAILED_EVENT = 'refund.failed';

/** Events to subscribe to in the Razorpay Dashboard. */
export const HANDLED_WEBHOOK_EVENTS = [...CREDIT_EVENTS, FAILURE_EVENT, ...REFUND_EVENTS, REFUND_FAILED_EVENT];

export type WebhookResult =
    | { status: 'not_configured' }
    | { status: 'invalid_signature' }
    | { status: 'invalid_payload' }
    | { status: 'ignored'; reason: string; event?: string }
    | { status: 'mismatch'; mismatch: PaymentMismatch; orderId: string; event: string }
    | { status: 'credited' | 'already_processed'; orderId: string; credits: number; event: string }
    | { status: 'marked_failed' | 'marked_refunded'; orderId: string; event: string }
    | { status: 'needs_review'; reason: string; orderId: string; event: string };

/**
 * Records a refund of a captured payment. Unpaid orders are closed as refunded
 * so they can never be credited; an order whose credits were already granted is
 * flagged for review, since taking credits back is a policy decision.
 */
const applyRefund = async (
    deps: PaymentServiceDeps,
    txn: TransactionRecord,
    payment: RazorpayPaymentEntity,
    event: string,
): Promise<WebhookResult> => {
    const orderId = txn.razorpayOrderId;

    // Razorpay auto-refunds payments that were authorized but never captured;
    // those were never creditable, and the order may still be paid by another attempt.
    if (payment.captured === false) return { status: 'ignored', reason: 'refund of an uncaptured payment', event };

    if (await markPaymentRefunded(deps.db, txn, payment.id)) return { status: 'marked_refunded', orderId, event };

    if (await flagRefundAfterCredit(deps.db, txn)) {
        return {
            status: 'needs_review',
            reason: 'refund on an order whose credits were already granted; marked refunded_after_credit, credits were not removed automatically',
            orderId,
            event,
        };
    }
    const current = await deps.db.transaction.findUnique({ where: { id: txn.id } });
    if (current?.status === TRANSACTION_STATUS.REFUNDED_AFTER_CREDIT) {
        return { status: 'ignored', reason: 'refund on a credited order that is already flagged for review', event };
    }
    return { status: 'ignored', reason: 'order already closed as refunded', event };
};

/**
 * Handles a Razorpay webhook delivery. `rawBody` must be the unparsed request
 * body — the signature is computed over the exact bytes Razorpay sent.
 * Repeated or concurrent deliveries are safe: every state change is a
 * conditional transition, so a duplicate event becomes a no-op.
 */
export const handleRazorpayWebhook = async (
    deps: PaymentServiceDeps,
    input: { rawBody: unknown; signature: unknown },
): Promise<WebhookResult> => {
    if (!deps.webhookSecret) return { status: 'not_configured' };

    if (!Buffer.isBuffer(input.rawBody) || typeof input.signature !== 'string' || !input.signature) {
        return { status: 'invalid_signature' };
    }
    if (!isValidWebhookSignature(deps.webhookSecret, input.rawBody, input.signature)) {
        return { status: 'invalid_signature' };
    }

    let body: any;
    try {
        body = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
        return { status: 'invalid_payload' };
    }

    const event: string | undefined = body?.event;
    if (!event || !HANDLED_WEBHOOK_EVENTS.includes(event)) {
        return { status: 'ignored', reason: 'unhandled event type', event };
    }

    const payment: RazorpayPaymentEntity | undefined = body?.payload?.payment?.entity;
    if (!payment || !isId(payment.id) || !isId(payment.order_id)) {
        return { status: 'ignored', reason: 'event has no order-linked payment', event };
    }

    const orderId = payment.order_id;
    const txn = await deps.db.transaction.findUnique({ where: { razorpayOrderId: orderId } });
    if (!txn) return { status: 'ignored', reason: 'order not created by this application', event };

    const mismatch = findPaymentMismatch(txn, payment);
    if (mismatch) return { status: 'mismatch', mismatch, orderId, event };

    if (event === FAILURE_EVENT) {
        const changed = await markPaymentFailed(deps.db, txn, payment.id);
        return changed
            ? { status: 'marked_failed', orderId, event }
            : { status: 'ignored', reason: 'order already closed', event };
    }

    if (REFUND_EVENTS.has(event)) return applyRefund(deps, txn, payment, event);

    if (event === REFUND_FAILED_EVENT) {
        if (txn.status === TRANSACTION_STATUS.REFUNDED) {
            return { status: 'needs_review', reason: 'refund failed on an order closed as refunded; the customer paid and has no credits', orderId, event };
        }
        if (txn.status === TRANSACTION_STATUS.REFUNDED_AFTER_CREDIT) {
            return { status: 'needs_review', reason: 'refund failed on a credited order flagged as refunded; check the refund in the Razorpay Dashboard', orderId, event };
        }
        return { status: 'ignored', reason: 'refund failed; order state unchanged', event };
    }

    // Credit events. Duplicates of a finished order need no API call.
    if (CREDITED_STATUSES.includes(txn.status)) {
        return { status: 'already_processed', orderId, credits: txn.credits, event };
    }
    if (txn.status === TRANSACTION_STATUS.REFUNDED) {
        return { status: 'ignored', reason: 'order closed as refunded', event };
    }

    // The payload is a snapshot that may be retried hours later, after a refund,
    // so credit only what Razorpay reports for the payment right now.
    const current = await callGateway('payment fetch', () => deps.gateway.fetchPayment(payment.id));

    const currentMismatch = findPaymentMismatch(txn, current);
    if (currentMismatch) return { status: 'mismatch', mismatch: currentMismatch, orderId, event };

    if (isRefundedPayment(current)) return applyRefund(deps, txn, current, event);

    if (!isCreditablePayment(current)) {
        return { status: 'ignored', reason: `payment status is ${current.status}`, event };
    }

    const outcome = await grantCreditsForPayment(deps.db, txn, { id: current.id });
    if (outcome === 'refunded') return { status: 'ignored', reason: 'order closed as refunded', event };
    return { status: outcome, orderId, credits: txn.credits, event };
};

// ─── Reconciliation ──────────────────────────────────────────────────────────
export type ReconcileOutcome =
    | GrantOutcome
    | 'would_credit'
    | 'marked_failed'
    | 'marked_refunded'
    | 'would_mark_refunded'
    | 'mismatch'
    | 'still_pending';

/**
 * Asks Razorpay for every payment on the order and grants credits if one was
 * captured and not refunded. Covers payments whose browser closed before
 * verification and whose webhook was missed. With `apply: false` nothing is written.
 */
export const reconcileTransaction = async (
    deps: PaymentServiceDeps,
    txn: TransactionRecord,
    options: { apply: boolean },
): Promise<{ outcome: ReconcileOutcome; paymentId?: string }> => {
    if (CREDITED_STATUSES.includes(txn.status)) return { outcome: 'already_processed' };
    if (txn.status === TRANSACTION_STATUS.REFUNDED) return { outcome: 'refunded' };

    const payments = await callGateway('order payments fetch', () =>
        deps.gateway.fetchOrderPayments(txn.razorpayOrderId),
    );

    const creditable = payments.filter(isCreditablePayment);
    const matching = creditable.find((p) => !findPaymentMismatch(txn, p));

    if (matching) {
        if (!options.apply) return { outcome: 'would_credit', paymentId: matching.id };
        const outcome = await grantCreditsForPayment(deps.db, txn, { id: matching.id });
        return { outcome, paymentId: matching.id };
    }

    // Captured money that doesn't match the order needs a human, not automation.
    if (creditable.length > 0) return { outcome: 'mismatch', paymentId: creditable[0].id };

    // A captured payment that was later refunded closes the order for good.
    const refunded = payments.find((p) => p.captured !== false && isRefundedPayment(p));
    if (refunded) {
        if (!options.apply) return { outcome: 'would_mark_refunded', paymentId: refunded.id };
        await markPaymentRefunded(deps.db, txn, refunded.id);
        return { outcome: 'marked_refunded', paymentId: refunded.id };
    }

    const failed = payments.find((p) => p.status === 'failed');
    if (failed && txn.status === TRANSACTION_STATUS.PENDING && options.apply) {
        await markPaymentFailed(deps.db, txn, failed.id);
        return { outcome: 'marked_failed', paymentId: failed.id };
    }

    return { outcome: 'still_pending' };
};

export interface ReconcileSummary {
    checked: number;
    results: Array<{ orderId: string; transactionId: string; outcome: ReconcileOutcome | 'error'; paymentId?: string; error?: string }>;
}

/**
 * Reconciles unpaid orders older than `minAgeMinutes` (so in-flight checkouts
 * are left alone) and younger than `maxAgeDays`.
 */
export const reconcilePendingTransactions = async (
    deps: PaymentServiceDeps,
    options: { apply: boolean; minAgeMinutes?: number; maxAgeDays?: number; limit?: number },
): Promise<ReconcileSummary> => {
    const now = deps.now?.() ?? new Date();
    const minAgeMs = (options.minAgeMinutes ?? 15) * 60 * 1000;
    const maxAgeMs = (options.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;

    const transactions = await deps.db.transaction.findMany({
        where: {
            status: { in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.FAILED] },
            createdAt: { gte: new Date(now.getTime() - maxAgeMs), lte: new Date(now.getTime() - minAgeMs) },
        },
        orderBy: { createdAt: 'asc' },
        take: options.limit ?? 100,
    });

    const results: ReconcileSummary['results'] = [];
    for (const txn of transactions) {
        try {
            const { outcome, paymentId } = await reconcileTransaction(deps, txn, { apply: options.apply });
            results.push({ orderId: txn.razorpayOrderId, transactionId: txn.id, outcome, paymentId });
        } catch (err: any) {
            deps.logger?.error('[reconcilePendingTransactions] Failed to reconcile order', {
                orderId: txn.razorpayOrderId,
                error: err?.message,
            });
            results.push({ orderId: txn.razorpayOrderId, transactionId: txn.id, outcome: 'error', error: err?.message });
        }
    }

    return { checked: transactions.length, results };
};
