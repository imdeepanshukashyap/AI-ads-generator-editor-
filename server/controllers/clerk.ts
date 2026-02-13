import { Request, Response } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks'
import { prisma } from '../configs/prisma.js';
import * as Sentry from "@sentry/node"
import logger, { maskSensitive } from '../configs/logger.js';

/**
 * Clerk Webhooks Handler
 * 
 * Handles webhook events from Clerk for user lifecycle and payment events
 */
const clerkWebhooks = async (req: Request, res: Response) => {
    logger.info('[clerkWebhooks] Webhook received', {
        requestId: req.requestId,
    });

    try {
        // Webhook verification
        logger.debug('[clerkWebhooks] Verifying webhook signature');
        const evt: any = await verifyWebhook(req)

        // Getting Data from request 
        const { data, type } = evt;
        logger.info('[clerkWebhooks] Webhook verified successfully', {
            eventType: type,
            userId: data?.id,
        });

        // Switch Cases for different Events
        switch (type) {
            case "user.created": {
                logger.info('[clerkWebhooks] Processing user.created event', {
                    userId: data.id,
                    email: data?.email_addresses?.[0]?.email_address,
                });

                if (!data.id || !data?.email_addresses?.[0]?.email_address) {
                    logger.error('[clerkWebhooks] Missing required user data', {
                        hasId: !!data.id,
                        hasEmail: !!data?.email_addresses?.[0]?.email_address,
                    });
                    return res.status(400).json({ message: 'Missing required user data' });
                }

                // Database operation: Create new user
                await prisma.user.create({
                    data: {
                        id: data.id,
                        email: data?.email_addresses[0]?.email_address,
                        name: data?.first_name + " " + data?.last_name,
                        image: data?.image_url,
                        credits: 20, // Explicitly set initial credits
                    }
                })

                logger.info('[clerkWebhooks] User created successfully', {
                    userId: data.id,
                    initialCredits: 20,
                });
                break;
            }

            case "user.updated": {
                logger.info('[clerkWebhooks] Processing user.updated event', {
                    userId: data.id,
                });

                // Database operation: Update user details
                await prisma.user.update({
                    where: {
                        id: data.id
                    },
                    data: {
                        email: data?.email_addresses[0]?.email_address,
                        name: data?.first_name + " " + data?.last_name,
                        image: data?.image_url,
                    }
                })

                logger.info('[clerkWebhooks] User updated successfully', { userId: data.id });
                break;
            }

            case "user.deleted": {
                logger.info('[clerkWebhooks] Processing user.deleted event', {
                    userId: data.id,
                });

                // Database operation: Delete user
                await prisma.user.delete({ where: { id: data.id } })

                logger.info('[clerkWebhooks] User deleted successfully', { userId: data.id });
                break;
            }

            case "paymentAttempt.updated": {
                logger.info('[clerkWebhooks] Processing paymentAttempt.updated event', {
                    chargeType: data.charge_type,
                    status: data.status,
                    // Mask sensitive payment data
                    paymentData: maskSensitive({
                        planSlug: data?.subscription_items?.[0]?.plan?.slug,
                        userId: data?.payer?.user_id,
                    }),
                });

                if ((data.charge_type === "recurring" || data.charge_type === "checkout") && data.status === "paid") {
                    const credits = { pro: 80, premium: 240, }
                    const clerkUserId = data?.payer?.user_id;
                    const planId: keyof typeof credits = data?.subscription_items?.[0]?.plan?.slug;

                    if (planId !== "pro" && planId !== "premium") {
                        logger.warn('[clerkWebhooks] Invalid plan ID in payment', {
                            planId,
                            userId: clerkUserId,
                        });
                        return res.status(400).json({ message: "Invalid plan" })
                    }

                    logger.info('[clerkWebhooks] Processing credit increment for payment', {
                        userId: clerkUserId,
                        planId,
                        creditsToAdd: credits[planId],
                    });

                    // Database operation: Increment user credits
                    await prisma.user.update({
                        where: { id: clerkUserId },
                        data: {
                            credits: { increment: credits[planId] }
                        }
                    })

                    logger.info('[clerkWebhooks] Credits added successfully', {
                        userId: clerkUserId,
                        creditsAdded: credits[planId],
                    });
                }
                break;
            }

            default:
                logger.debug('[clerkWebhooks] Unhandled webhook event type', { eventType: type });
                break;
        }

        logger.info('[clerkWebhooks] Webhook processed successfully', { eventType: type });
        res.json({ message: "Webhook Recieved : " + type })

    } catch (error: any) {
        logger.error('[clerkWebhooks] Webhook processing failed', {
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error)
        res.status(500).json({ message: error.message });
    }
}

export default clerkWebhooks