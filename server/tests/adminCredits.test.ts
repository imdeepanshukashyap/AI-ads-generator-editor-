import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adjustUserCredits, formatMoney, toPurchaseHistoryRow, type CreditAdjustmentDb } from '../services/adminService.js';

const purchase = (overrides: Partial<Parameters<typeof toPurchaseHistoryRow>[0]> = {}) => ({
    id: 'txn_1',
    userId: 'user_a',
    planName: 'Pro',
    amount: 900,
    currency: 'INR',
    credits: 80,
    status: 'success',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    user: { id: 'user_a', name: 'Asha', email: 'asha@example.test' },
    ...overrides,
});

describe('toPurchaseHistoryRow', () => {
    it('shows a captured payment as a credit addition with the money paid', () => {
        const row = toPurchaseHistoryRow(purchase());
        assert.equal(row.type, 'ADD');
        assert.equal(row.amount, '80 credits · ₹9.00');
        assert.equal(row.moneyPaid, 900);
        assert.equal(row.currency, 'INR');
        assert.equal(row.status, 'success');
        assert.equal(row.reason, 'Pro purchase');
        assert.equal(row.balance, null);
    });

    for (const status of ['pending', 'failed', 'refunded']) {
        it(`shows a ${status} payment as no credits added and no money received`, () => {
            const row = toPurchaseHistoryRow(purchase({ status }));
            assert.equal(row.type, `PAYMENT_${status.toUpperCase()}`);
            assert.notEqual(row.type, 'ADD');
            assert.equal(row.amount, '₹9.00 · no credits added');
            assert.equal(row.moneyPaid, 0);
            assert.equal(row.currency, 'INR');
            assert.equal(row.status, status);
            assert.equal(row.reason, `Pro purchase (${status})`);
        });
    }

    it('keeps a payment refunded after its credits were added as an addition, flagged for review', () => {
        const row = toPurchaseHistoryRow(purchase({ status: 'refunded_after_credit' }));
        assert.equal(row.type, 'ADD');
        assert.equal(row.needsReview, true);
        assert.equal(row.amount, '80 credits · ₹9.00 · payment refunded after credits were added — review');
        assert.equal(row.moneyPaid, null, 'full or partial refund; the amount is in Razorpay');
        assert.equal(row.reason, 'Pro purchase (refunded_after_credit)');
        assert.equal(toPurchaseHistoryRow(purchase()).needsReview, false);
    });

    it('uses the transaction currency instead of assuming INR', () => {
        const row = toPurchaseHistoryRow(purchase({ amount: 1500, currency: 'USD' }));
        assert.equal(row.currency, 'USD');
        assert.equal(row.amount, '80 credits · $15.00');
        assert.equal(row.moneyPaid, 1500);
    });
});

describe('formatMoney', () => {
    it('converts from the smallest currency unit using the currency’s decimal places', () => {
        assert.equal(formatMoney(900, 'INR'), '₹9.00');
        assert.equal(formatMoney(295, 'JPY'), 'JP¥295');
    });

    it('falls back to a plain amount for a code Intl rejects', () => {
        assert.equal(formatMoney(900, 'not-a-code'), '9.00 not-a-code');
    });
});

/** In-memory stand-in that applies updateMany's where clause the way Postgres does. */
const fakeDb = (balances: Record<string, number>) => {
    const history: Array<Record<string, unknown>> = [];
    const logs: Array<Record<string, unknown>> = [];
    const updateWheres: Array<Record<string, any>> = [];
    const tx = {
        user: {
            updateMany: async ({ where, data }: any) => {
                updateWheres.push(where);
                const credits = balances[where.id];
                if (credits === undefined || (where.credits && credits < where.credits.gte)) return { count: 0 };
                balances[where.id] = credits + (data.credits.increment ?? -data.credits.decrement);
                return { count: 1 };
            },
            findUnique: async ({ where }: any) => (where.id in balances ? { id: where.id } : null),
            findUniqueOrThrow: async ({ where }: any) => ({ id: where.id, credits: balances[where.id] }),
        },
        creditTransaction: { create: async ({ data }: any) => history.push(data) },
        adminLog: { create: async ({ data }: any) => logs.push(data) },
    };
    const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as CreditAdjustmentDb;
    return { db, balances, history, logs, updateWheres };
};

const change = (operation: 'ADD' | 'REMOVE', amount: number, userId = 'user_a') =>
    ({ userId, adminId: 'admin_1', amount, operation, reason: 'Support correction', ipAddress: '127.0.0.1', userAgent: 'test' });

describe('adjustUserCredits', () => {
    it('adds credits and records the resulting balance in history and the audit log', async () => {
        const { db, balances, history, logs } = fakeDb({ user_a: 20 });
        assert.deepEqual(await adjustUserCredits(db, change('ADD', 15)), { status: 'updated', user: { id: 'user_a', credits: 35 } });
        assert.equal(balances.user_a, 35);
        assert.deepEqual(history, [{ userId: 'user_a', adminId: 'admin_1', type: 'ADD', amount: 15, balance: 35, reason: 'Support correction' }]);
        assert.equal(logs.length, 1);
        assert.equal(logs[0].action, 'CREDITS_ADDED');
    });

    it('makes the balance check part of the removal UPDATE', async () => {
        const { db, balances, history, logs, updateWheres } = fakeDb({ user_a: 100 });
        assert.equal((await adjustUserCredits(db, change('REMOVE', 30))).status, 'updated');
        assert.deepEqual(updateWheres[0], { id: 'user_a', credits: { gte: 30 } });
        assert.equal(balances.user_a, 70);
        assert.equal(history[0].balance, 70);
        assert.equal(logs[0].action, 'CREDITS_REMOVED');
    });

    it('allows removing the whole balance', async () => {
        const { db, balances } = fakeDb({ user_a: 30 });
        assert.equal((await adjustUserCredits(db, change('REMOVE', 30))).status, 'updated');
        assert.equal(balances.user_a, 0);
    });

    it('refuses a removal larger than the balance and writes nothing', async () => {
        const { db, balances, history, logs } = fakeDb({ user_a: 29 });
        assert.deepEqual(await adjustUserCredits(db, change('REMOVE', 30)), { status: 'insufficient_credits' });
        assert.equal(balances.user_a, 29);
        assert.deepEqual([history.length, logs.length], [0, 0]);
    });

    it('reports an unknown user and writes nothing', async () => {
        const { db, history, logs } = fakeDb({});
        assert.deepEqual(await adjustUserCredits(db, change('ADD', 5, 'user_missing')), { status: 'not_found' });
        assert.deepEqual([history.length, logs.length], [0, 0]);
    });
});
