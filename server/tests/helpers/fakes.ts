import crypto from 'crypto';
import type { PaymentDb, RazorpayGateway, RazorpayOrderEntity, RazorpayPaymentEntity } from '../../services/paymentService.js';

/**
 * In-memory stand-ins for the Prisma client subset and Razorpay SDK used by
 * services/paymentService.ts.
 *
 * Every operation yields to the event loop before touching state so concurrent
 * callers genuinely interleave — a read-then-write bug would double-credit here.
 * $transaction serialises callers (like Postgres row locks on the same row) and
 * undoes its own writes if the callback throws.
 */

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface TxnRow {
    id: string;
    userId: string;
    planId: string;
    planName: string;
    amount: number;
    currency: string;
    credits: number;
    razorpayOrderId: string;
    razorpayPaymentId: string | null;
    razorpaySignature: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}

type Where = Record<string, any>;

const matches = (row: Record<string, any>, where: Where): boolean =>
    Object.entries(where).every(([key, condition]) => {
        const value = row[key];
        if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
            if ('in' in condition && !condition.in.includes(value)) return false;
            if ('gte' in condition && !(value >= condition.gte)) return false;
            if ('lte' in condition && !(value <= condition.lte)) return false;
            return true;
        }
        return value === condition;
    });

export class FakePaymentDb {
    users = new Map<string, { id: string; credits: number }>();
    transactions = new Map<string, TxnRow>();
    /** Number of upcoming user.update calls that should fail (simulated DB outage). */
    failUserUpdates = 0;
    transactionCalls = 0;

    private txQueue: Promise<unknown> = Promise.resolve();

    readonly transaction;
    readonly user;

    constructor() {
        const client = this.createClient(null);
        this.transaction = client.transaction;
        this.user = client.user;
    }

    addUser(id: string, credits: number) {
        this.users.set(id, { id, credits });
    }

    credits(userId: string) {
        return this.users.get(userId)?.credits;
    }

    txnByOrder(orderId: string) {
        return [...this.transactions.values()].find((t) => t.razorpayOrderId === orderId);
    }

    async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        this.transactionCalls++;
        const run = async () => {
            const undo: Array<() => void> = [];
            try {
                return await fn(this.createClient(undo));
            } catch (err) {
                undo.reverse().forEach((restore) => restore());
                throw err;
            }
        };
        const result = this.txQueue.then(run, run);
        this.txQueue = result.catch(() => undefined);
        return result;
    }

    /** Cast for passing into the service, which is typed against Prisma. */
    asDb(): PaymentDb {
        return this as unknown as PaymentDb;
    }

    private createClient(undo: Array<() => void> | null) {
        const remember = (row: Record<string, any>) => {
            const before = { ...row };
            undo?.push(() => Object.assign(row, before));
        };

        return {
            transaction: {
                findUnique: async ({ where }: { where: Where }) => {
                    await tick();
                    const row = [...this.transactions.values()].find((t) => matches(t, where));
                    return row ? { ...row } : null;
                },
                create: async ({ data }: { data: Partial<TxnRow> & Pick<TxnRow, 'userId' | 'razorpayOrderId'> }) => {
                    await tick();
                    if (this.txnByOrder(data.razorpayOrderId)) {
                        throw new Error('Unique constraint failed on razorpayOrderId');
                    }
                    const now = new Date();
                    const row: TxnRow = {
                        id: crypto.randomUUID(),
                        planId: '',
                        planName: '',
                        amount: 0,
                        currency: 'INR',
                        credits: 0,
                        razorpayPaymentId: null,
                        razorpaySignature: null,
                        status: 'pending',
                        createdAt: now,
                        updatedAt: now,
                        ...data,
                    };
                    this.transactions.set(row.id, row);
                    undo?.push(() => this.transactions.delete(row.id));
                    return { ...row };
                },
                updateMany: async ({ where, data }: { where: Where; data: Partial<TxnRow> }) => {
                    await tick();
                    let count = 0;
                    for (const row of this.transactions.values()) {
                        if (!matches(row, where)) continue;
                        remember(row);
                        Object.assign(row, data, { updatedAt: new Date() });
                        count++;
                    }
                    return { count };
                },
                count: async ({ where }: { where: Where }) => {
                    await tick();
                    return [...this.transactions.values()].filter((t) => matches(t, where)).length;
                },
                findMany: async ({ where, take }: { where: Where; take?: number }) => {
                    await tick();
                    return [...this.transactions.values()]
                        .filter((t) => matches(t, where))
                        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                        .slice(0, take ?? Infinity)
                        .map((t) => ({ ...t }));
                },
            },
            user: {
                update: async ({ where, data }: { where: { id: string }; data: { credits: { increment: number } } }) => {
                    await tick();
                    if (this.failUserUpdates > 0) {
                        this.failUserUpdates--;
                        throw new Error('Simulated database failure');
                    }
                    const user = this.users.get(where.id);
                    if (!user) throw new Error('Record to update not found');
                    remember(user);
                    user.credits += data.credits.increment;
                    return { ...user };
                },
            },
        };
    }
}

export class FakeRazorpayGateway implements RazorpayGateway {
    orders = new Map<string, RazorpayOrderEntity & { receipt: string; notes: Record<string, string> }>();
    payments = new Map<string, RazorpayPaymentEntity>();
    createOrderCalls: Array<Parameters<RazorpayGateway['createOrder']>[0]> = [];
    fetchPaymentCalls = 0;
    failNextCall: Error | null = null;
    private seq = 0;

    private maybeFail() {
        if (this.failNextCall) {
            const err = this.failNextCall;
            this.failNextCall = null;
            throw err;
        }
    }

    async createOrder(params: Parameters<RazorpayGateway['createOrder']>[0]) {
        await tick();
        this.createOrderCalls.push(params);
        this.maybeFail();
        const order = { id: `order_TEST${++this.seq}`, amount: params.amount, currency: params.currency, receipt: params.receipt, notes: params.notes };
        this.orders.set(order.id, order);
        return { id: order.id, amount: order.amount, currency: order.currency };
    }

    async fetchPayment(paymentId: string) {
        await tick();
        this.fetchPaymentCalls++;
        this.maybeFail();
        const payment = this.payments.get(paymentId);
        if (!payment) throw Object.assign(new Error('The id provided does not exist'), { statusCode: 400 });
        return { ...payment };
    }

    async fetchOrderPayments(orderId: string) {
        await tick();
        this.maybeFail();
        return [...this.payments.values()].filter((p) => p.order_id === orderId).map((p) => ({ ...p }));
    }

    /** Simulates a customer paying an order in Razorpay Checkout. */
    addPayment(payment: Partial<RazorpayPaymentEntity> & { order_id: string }) {
        const order = this.orders.get(payment.order_id);
        const status = payment.status ?? 'captured';
        const entity: RazorpayPaymentEntity = {
            id: `pay_TEST${++this.seq}`,
            amount: order?.amount ?? 0,
            currency: order?.currency ?? 'INR',
            status,
            captured: status === 'captured',
            amount_refunded: 0,
            refund_status: null,
            ...payment,
        };
        this.payments.set(entity.id, entity);
        return { ...entity }; // a snapshot, like a webhook payload; later changes don't affect it
    }

    setPaymentStatus(paymentId: string, status: string) {
        const payment = this.payments.get(paymentId);
        if (!payment) return;
        payment.status = status;
        if (status === 'captured') payment.captured = true;
    }

    /** Simulates a refund issued from the Dashboard (full by default), as Razorpay reports it. */
    refundPayment(paymentId: string, amount?: number) {
        const payment = this.payments.get(paymentId)!;
        const refunded = amount ?? Number(payment.amount);
        const full = refunded >= Number(payment.amount);
        Object.assign(payment, {
            amount_refunded: refunded,
            refund_status: full ? 'full' : 'partial',
            status: full ? 'refunded' : payment.status,
        });
        return { ...payment };
    }
}

export const signCheckout = (secret: string, orderId: string, paymentId: string) =>
    crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

/** A signed webhook delivery shaped like Razorpay's (refund events also carry the refund entity). */
export const webhookDelivery = (secret: string, event: string, payment: RazorpayPaymentEntity) => {
    const isRefund = event.startsWith('refund.');
    const refund = {
        entity: 'refund',
        id: `rfnd_${payment.id}`,
        payment_id: payment.id,
        amount: Number(payment.amount_refunded) || Number(payment.amount),
        currency: payment.currency,
        status: event === 'refund.processed' ? 'processed' : event === 'refund.failed' ? 'failed' : 'pending',
    };
    const rawBody = Buffer.from(JSON.stringify({
        entity: 'event',
        event,
        contains: isRefund ? ['refund', 'payment'] : ['payment'],
        payload: {
            ...(isRefund ? { refund: { entity: refund } } : {}),
            payment: { entity: { entity: 'payment', ...payment } },
        },
        created_at: Math.floor(Date.now() / 1000),
    }));
    return { rawBody, signature: crypto.createHmac('sha256', secret).update(rawBody).digest('hex') };
};
