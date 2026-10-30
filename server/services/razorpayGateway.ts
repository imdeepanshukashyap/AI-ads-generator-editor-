import Razorpay from 'razorpay';
import type { RazorpayGateway } from './paymentService.js';

/**
 * Razorpay SDK adapter for paymentService. Kept free of database and logger
 * imports so scripts and integration tests can use the real API on their own.
 */

export type RazorpayKeyMode = 'test' | 'live';

const KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]+$/;

/** Mode of a Razorpay key id, or null if it is not a Razorpay key id at all. */
export const getRazorpayKeyMode = (keyId: string | undefined | null): RazorpayKeyMode | null => {
    const match = keyId ? KEY_ID_PATTERN.exec(keyId) : null;
    return match ? (match[1] as RazorpayKeyMode) : null;
};

export interface RazorpayEnvCheck {
    mode: RazorpayKeyMode | null;
    /** Payments must stay disabled while any error remains (fail closed). */
    errors: string[];
    warnings: string[];
}

/**
 * Validates the Razorpay variables. Messages name variables, never values.
 * RAZORPAY_MODE is optional; when set, keys from the other mode are refused, so
 * a half-finished switch between test and live disables payments instead of
 * running in the wrong mode.
 */
export const checkRazorpayEnv = (env: NodeJS.ProcessEnv = process.env): RazorpayEnvCheck => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const keyId = env.RAZORPAY_KEY_ID?.trim();
    const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
    const expectedMode = env.RAZORPAY_MODE?.trim().toLowerCase();
    const mode = getRazorpayKeyMode(keyId);

    if (!keyId || !keySecret) {
        errors.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set');
    } else if (!mode) {
        errors.push('RAZORPAY_KEY_ID is not a Razorpay key id (expected rzp_test_... or rzp_live_...)');
    }

    if (expectedMode && expectedMode !== 'test' && expectedMode !== 'live') {
        errors.push('RAZORPAY_MODE must be "test" or "live"');
    } else if (expectedMode && mode && expectedMode !== mode) {
        errors.push(`RAZORPAY_MODE is "${expectedMode}" but RAZORPAY_KEY_ID is a ${mode} key`);
    }

    if (keySecret?.startsWith('rzp_')) {
        warnings.push('RAZORPAY_KEY_SECRET looks like a key id; copy the key secret instead');
    }
    if (!webhookSecret) {
        warnings.push('RAZORPAY_WEBHOOK_SECRET is not set; webhook deliveries will be rejected');
    } else if (webhookSecret === keySecret) {
        warnings.push('RAZORPAY_WEBHOOK_SECRET equals the key secret; use the separate secret entered on the webhook');
    }
    if (env.NODE_ENV === 'production' && mode === 'test' && !expectedMode) {
        warnings.push('Production is using TEST keys, so Razorpay test payment methods buy real credits. Set RAZORPAY_MODE=test to acknowledge this, or switch to live keys');
    }

    return { mode, errors, warnings };
};

export const createRazorpayGateway = (keyId: string, keySecret: string): RazorpayGateway => {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });

    return {
        createOrder: async (params) => client.orders.create(params),
        fetchPayment: async (paymentId) => client.payments.fetch(paymentId),
        fetchOrderPayments: async (orderId) => (await client.orders.fetchPayments(orderId)).items,
    };
};
