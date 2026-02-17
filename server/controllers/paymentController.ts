import { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { prisma } from '../configs/prisma.js';
import logger from '../configs/logger.js';
import * as Sentry from '@sentry/node';

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!
});

// Plan configurations matching frontend
const PLANS = {
    starter: { name: 'Free', price: 0, credits: 20 },        // Free plan
    pro: { name: 'Pro', price: 900, credits: 80 },           // ₹9 = 900 paise
    ultra: { name: 'Premium', price: 2900, credits: 240 }    // ₹29 = 2900 paise
};

/**
 * Create Razorpay Order
 * 
 * Creates a Razorpay order for the selected plan
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

        const { planId } = req.body;

        // Validate plan
        if (!planId || !PLANS[planId as keyof typeof PLANS]) {
            logger.warn('[createOrder] Invalid plan ID', { userId, planId });
            return res.status(400).json({ message: 'Invalid plan selected' });
        }

        const plan = PLANS[planId as keyof typeof PLANS];

        logger.info('[createOrder] Creating Razorpay order', {
            userId,
            planId,
            amount: plan.price,
        });

        // Create Razorpay order
        const options = {
            amount: plan.price, // Amount in paise
            currency: 'INR',
            receipt: `order_${Date.now()}`,
            notes: {
                userId,
                planId,
                credits: plan.credits.toString()
            }
        };

        const order = await razorpay.orders.create(options);

        logger.info('[createOrder] Razorpay order created successfully', {
            userId,
            orderId: order.id,
            amount: order.amount,
        });

        // Create transaction record in database
        await prisma.transaction.create({
            data: {
                userId,
                planId,
                planName: plan.name,
                amount: plan.price,
                credits: plan.credits,
                razorpayOrderId: order.id,
                status: 'pending'
            }
        });

        logger.info('[createOrder] Transaction record created', {
            userId,
            orderId: order.id,
        });

        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID
        });

    } catch (error: any) {
        logger.error('[createOrder] Request failed with error', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to create order. Please try again.' });
    }
};

/**
 * Verify Payment
 * 
 * Verifies Razorpay payment signature and adds credits to user account
 */
export const verifyPayment = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    logger.info('[verifyPayment] Request received', {
        userId,
        requestId: req.requestId,
    });

    try {
        // Auth validation
        if (!userId) {
            logger.warn('[verifyPayment] Unauthorized access attempt', { requestId: req.requestId });
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        // Validate required fields
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            logger.warn('[verifyPayment] Missing required fields', { userId });
            return res.status(400).json({ message: 'Missing payment details' });
        }

        logger.info('[verifyPayment] Verifying payment signature', {
            userId,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
        });

        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
            .update(body.toString())
            .digest('hex');

        const isAuthentic = expectedSignature === razorpay_signature;

        if (!isAuthentic) {
            logger.error('[verifyPayment] Invalid payment signature', {
                userId,
                orderId: razorpay_order_id,
            });

            // Update transaction as failed
            await prisma.transaction.updateMany({
                where: { razorpayOrderId: razorpay_order_id },
                data: {
                    status: 'failed',
                    razorpayPaymentId: razorpay_payment_id,
                    razorpaySignature: razorpay_signature
                }
            });

            return res.status(400).json({ message: 'Payment verification failed' });
        }

        logger.info('[verifyPayment] Payment signature verified successfully', {
            userId,
            orderId: razorpay_order_id,
        });

        // Get transaction details
        const transaction = await prisma.transaction.findUnique({
            where: { razorpayOrderId: razorpay_order_id }
        });

        if (!transaction) {
            logger.error('[verifyPayment] Transaction not found', {
                userId,
                orderId: razorpay_order_id,
            });
            return res.status(404).json({ message: 'Transaction not found' });
        }

        // Check if already processed (idempotency)
        if (transaction.status === 'success') {
            logger.warn('[verifyPayment] Transaction already processed', {
                userId,
                orderId: razorpay_order_id,
            });
            return res.json({
                message: 'Payment already processed',
                credits: transaction.credits
            });
        }

        logger.info('[verifyPayment] Adding credits to user account', {
            userId,
            creditsToAdd: transaction.credits,
        });

        // Add credits to user and update transaction
        await prisma.$transaction([
            prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: transaction.credits } }
            }),
            prisma.transaction.update({
                where: { razorpayOrderId: razorpay_order_id },
                data: {
                    status: 'success',
                    razorpayPaymentId: razorpay_payment_id,
                    razorpaySignature: razorpay_signature
                }
            })
        ]);

        logger.info('[verifyPayment] Payment verified and credits added successfully', {
            userId,
            orderId: razorpay_order_id,
            creditsAdded: transaction.credits,
        });

        res.json({
            message: 'Payment successful',
            credits: transaction.credits
        });

    } catch (error: any) {
        logger.error('[verifyPayment] Request failed with error', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Payment verification failed. Please contact support.' });
    }
};
