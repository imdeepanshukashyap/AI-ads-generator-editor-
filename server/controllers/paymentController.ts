import { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import logger from '../configs/logger.js';
import * as Sentry from '@sentry/node';
import { getPaymentConfig } from '../configs/razorpay.js';
import {
    createCheckoutOrder,
    handleRazorpayWebhook,
    PaymentGatewayError,
    verifyCheckoutPayment,
} from '../services/paymentService.js';

const PAYMENTS_UNAVAILABLE = 'Payments are temporarily unavailable. Please try again later.';

/**
 * Create Razorpay Order
 *
 * Creates a Razorpay order for the selected plan. Only `planId` is read from
 * the request; price, currency and credits come from the server-side plan list.
 */
export const createOrder = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    logger.info('[createOrder] Request received', {
        userId,
        requestId: req.requestId,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[createOrder] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const config = getPaymentConfig();
        if (!config) return res.status(503).json({ message: PAYMENTS_UNAVAILABLE });

        const planId = req.body?.planId;
        const result = await createCheckoutOrder(config, { userId, planId });

        if (!result.ok) {
            logger.warn('[createOrder] Order rejected', { userId, planId, reason: result.reason });
            if (result.reason === 'free_plan') {
                return res.status(400).json({ message: 'The Free plan does not require a payment.' });
            }
            if (result.reason === 'too_many_pending') {
                return res.status(429).json({ message: 'Too many unfinished checkout attempts. Please wait a few minutes and try again.' });
            }
            return res.status(400).json({ message: 'Invalid plan selected' });
        }

        logger.info('[createOrder] Razorpay order and transaction created', {
            userId,
            planId,
            orderId: result.orderId,
            transactionId: result.transactionId,
            amount: result.amount,
        });

        // Checkout opens with this key id, so it always belongs to the same
        // account and mode as the secret the server verifies with.
        res.json({
            orderId: result.orderId,
            amount: result.amount,
            currency: result.currency,
            keyId: config.keyId, // Public key id; the key secret never leaves the server
            mode: config.mode,
        });

    } catch (error: any) {
        logger.error('[createOrder] Request failed with error', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        const status = error instanceof PaymentGatewayError ? 502 : 500;
        res.status(status).json({ message: 'Failed to create order. Please try again.' });
    }
};

/**
 * Verify Payment
 *
 * Verifies a completed checkout (ownership, signature, and the payment's
 * status/amount/currency as reported by Razorpay) and grants credits once.
 */
export const verifyPayment = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};

    logger.info('[verifyPayment] Request received', {
        userId,
        requestId: req.requestId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[verifyPayment] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const config = getPaymentConfig();
        if (!config) return res.status(503).json({ message: PAYMENTS_UNAVAILABLE });

        const result = await verifyCheckoutPayment(config, {
            userId,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });

        const context = { userId, orderId: razorpay_order_id, paymentId: razorpay_payment_id };

        switch (result.status) {
            case 'invalid_request':
                logger.warn('[verifyPayment] Missing or malformed payment details', { userId });
                return res.status(400).json({ message: 'Missing payment details' });

            case 'not_found':
                logger.warn('[verifyPayment] Transaction not found for this user', context);
                return res.status(404).json({ message: 'Transaction not found' });

            case 'invalid_signature':
                logger.error('[verifyPayment] Invalid payment signature - no changes made', context);
                return res.status(400).json({ message: 'Payment verification failed' });

            case 'mismatch':
                logger.error('[verifyPayment] Razorpay payment does not match the order', { ...context, mismatch: result.mismatch });
                Sentry.captureMessage(`Razorpay payment ${result.mismatch} mismatch for order ${razorpay_order_id}`, 'error');
                return res.status(400).json({ message: 'Payment details do not match this order. No credits were added.' });

            case 'pending':
                logger.warn('[verifyPayment] Payment not yet captured', { ...context, paymentStatus: result.paymentStatus });
                return res.status(202).json({
                    status: 'pending',
                    message: 'Payment received and awaiting confirmation from Razorpay. Your credits will be added automatically once it is confirmed.',
                    credits: result.credits,
                });

            case 'rejected':
                logger.warn('[verifyPayment] Payment not successful', { ...context, paymentStatus: result.paymentStatus });
                return res.status(400).json({ message: 'Payment was not successful. No credits were added.' });

            case 'refunded':
                logger.warn('[verifyPayment] Payment was refunded - not credited', context);
                return res.status(400).json({ message: 'This payment has been refunded, so no credits were added.' });

            case 'already_processed':
                logger.warn('[verifyPayment] Transaction already processed', context);
                return res.json({ status: 'already_processed', message: 'Payment already processed', credits: result.credits });

            case 'credited':
                logger.info('[verifyPayment] Payment verified and credits added successfully', { ...context, creditsAdded: result.credits });
                return res.json({ status: 'credited', message: 'Payment successful', credits: result.credits });
        }

    } catch (error: any) {
        logger.error('[verifyPayment] Request failed with error', {
            userId,
            orderId: razorpay_order_id,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);

        if (error instanceof PaymentGatewayError) {
            return res.status(502).json({
                message: 'We could not confirm your payment with Razorpay right now. If money was deducted, your credits will be added automatically once the payment is confirmed.',
            });
        }
        res.status(500).json({ message: 'Payment verification failed. Please contact support.' });
    }
};

/**
 * Razorpay Webhook
 *
 * Registered in server.ts with express.raw() so the signature can be checked
 * against the exact request bytes. Confirms payments when the browser never
 * reached /verify. Non-2xx responses make Razorpay retry the delivery.
 */
export const razorpayWebhook = async (req: Request, res: Response) => {
    const eventId = req.get('x-razorpay-event-id');

    try {
        const config = getPaymentConfig();
        if (!config) return res.status(503).json({ message: PAYMENTS_UNAVAILABLE });

        const result = await handleRazorpayWebhook(config, {
            rawBody: req.body,
            signature: req.get('x-razorpay-signature'),
        });

        switch (result.status) {
            case 'not_configured':
                logger.error('[razorpayWebhook] RAZORPAY_WEBHOOK_SECRET is not set - rejecting webhook', { eventId });
                return res.status(503).json({ message: 'Webhook not configured' });

            case 'invalid_signature':
            case 'invalid_payload':
                logger.warn('[razorpayWebhook] Rejected webhook', { eventId, reason: result.status });
                return res.status(400).json({ message: 'Invalid webhook' });

            case 'mismatch':
                // Retrying will not fix this; acknowledge and flag for manual review.
                logger.error('[razorpayWebhook] Payment does not match order - not credited', { eventId, ...result });
                Sentry.captureMessage(`Razorpay webhook ${result.mismatch} mismatch for order ${result.orderId}`, 'error');
                break;

            case 'needs_review':
                // Acknowledged so Razorpay stops retrying; a person has to decide what happens next.
                logger.error('[razorpayWebhook] Payment needs manual review', { eventId, ...result });
                Sentry.captureMessage(`Razorpay ${result.event} for order ${result.orderId} needs review: ${result.reason}`, 'error');
                break;

            case 'ignored':
                logger.info('[razorpayWebhook] Webhook ignored', { eventId, event: result.event, reason: result.reason });
                break;

            default:
                logger.info('[razorpayWebhook] Webhook processed', { eventId, ...result });
        }

        res.json({ received: true });

    } catch (error: any) {
        logger.error('[razorpayWebhook] Webhook processing failed', {
            eventId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Webhook processing failed' });
    }
};
