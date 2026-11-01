import logger from './logger.js';
import { prisma } from './prisma.js';
import type { PaymentServiceDeps } from '../services/paymentService.js';
import { checkRazorpayEnv, createRazorpayGateway, type RazorpayKeyMode } from '../services/razorpayGateway.js';

export type PaymentConfig = PaymentServiceDeps & { keyId: string; mode: RazorpayKeyMode };

let paymentConfig: PaymentConfig | null | undefined;

/**
 * Lazily builds the payment dependencies from the environment.
 *
 * Returns null (instead of crashing the whole server at import time) when the
 * Razorpay configuration is missing, malformed or in the wrong mode, so payment
 * routes answer 503 while image and video generation keep working. Secrets are
 * never logged.
 */
export const getPaymentConfig = (): PaymentConfig | null => {
    if (paymentConfig !== undefined) return paymentConfig;

    const { mode, errors, warnings } = checkRazorpayEnv(process.env);
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null;

    if (errors.length > 0 || !mode || !keyId || !keySecret) {
        errors.forEach((error) => logger.error(`[Razorpay] ${error} - payments are disabled`));
        paymentConfig = null;
        return paymentConfig;
    }

    logger.info('[Razorpay] Payment gateway configured', {
        mode,
        expectedMode: process.env.RAZORPAY_MODE || 'not set',
        webhookConfigured: !!webhookSecret,
    });
    warnings.forEach((warning) => logger.warn(`[Razorpay] ${warning}`));

    paymentConfig = {
        db: prisma,
        gateway: createRazorpayGateway(keyId, keySecret),
        keyId,
        mode,
        keySecret,
        webhookSecret,
        logger,
    };
    return paymentConfig;
};
