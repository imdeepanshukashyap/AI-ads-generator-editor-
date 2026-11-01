import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../configs/prisma.js';
import logger from '../configs/logger.js';
import * as Sentry from '@sentry/node';
import { canPostTo } from '../services/social/validator.js';
import { uploadShort } from '../services/social/youtube.js';
import { postFacebookPhoto, postFacebookVideo, publishInstagram } from '../services/social/meta.js';

let cronTask: ScheduledTask | null = null;
let isProcessing = false;

/**
 * Checks if an error represents an unrecoverable authorization failure
 * (e.g. revoked token, invalid_grant, OAuthException 190).
 */
function isAuthRevokedError(err: any): boolean {
    const msg = (err?.message || err?.toString() || '').toLowerCase();
    const status = err?.status || err?.response?.status;
    const errCode = err?.response?.data?.error?.code;
    const errType = err?.response?.data?.error?.type;

    if (errCode === 190 || errType === 'OAuthException') return true;
    if (status === 401) return true;
    if (msg.includes('invalid_grant') || msg.includes('revoked') || msg.includes('reconnect') || msg.includes('token expired')) {
        return true;
    }
    return false;
}

/**
 * Reaps orphaned posts that got stuck in 'publishing' state for > 10 minutes
 * (e.g. worker process crashed or network disconnected during long video upload).
 */
export async function reapZombies(): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    try {
        const stuckPosts = await prisma.scheduledPost.findMany({
            where: {
                status: 'publishing',
                updatedAt: { lt: tenMinutesAgo },
            },
        });

        if (stuckPosts.length === 0) return;

        logger.warn('[Scheduler Reaper] Found stuck posts in publishing state', {
            count: stuckPosts.length,
        });

        for (const post of stuckPosts) {
            const nextAttempts = post.attempts + 1;

            if (nextAttempts >= 3) {
                await prisma.scheduledPost.update({
                    where: { id: post.id },
                    data: {
                        status: 'failed',
                        error: 'Publishing timed out after 10 minutes in progress (Reaped by scheduler)',
                        attempts: nextAttempts,
                    },
                });
                logger.error('[Scheduler Reaper] Marked post as failed after max attempts', { postId: post.id });
            } else {
                // Backoff retry: 2^attempts minutes
                const backoffMs = Math.pow(2, nextAttempts) * 60 * 1000;
                const nextRun = new Date(Date.now() + backoffMs);

                await prisma.scheduledPost.update({
                    where: { id: post.id },
                    data: {
                        status: 'scheduled',
                        scheduledFor: nextRun,
                        attempts: nextAttempts,
                        error: 'Previous publishing attempt timed out - retrying with backoff',
                    },
                });
                logger.info('[Scheduler Reaper] Re-scheduled stuck post with backoff', {
                    postId: post.id,
                    nextRun: nextRun.toISOString(),
                    attempt: nextAttempts,
                });
            }
        }
    } catch (reaperErr: any) {
        logger.error('[Scheduler Reaper] Error during zombie reap cycle', {
            error: reaperErr.message,
        });
    }
}

/**
 * Executes a single scheduled post delivery.
 */
async function publishPostItem(post: any): Promise<void> {
    const { socialAccount, project } = post;

    logger.info('[Scheduler] Processing due post', {
        postId: post.id,
        platform: socialAccount.platform,
        mediaType: post.mediaType,
    });

    const validation = canPostTo(
        socialAccount.platform as any,
        post.mediaType as any,
        project.aspectRatio,
        post.mediaUrl
    );

    if (!validation.canPost) {
        await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
                status: 'failed',
                error: validation.reason || 'Format incompatible with target platform',
            },
        });
        logger.warn('[Scheduler] Post failed format compatibility check', {
            postId: post.id,
            reason: validation.reason,
        });
        return;
    }

    const effectiveMediaUrl = validation.transformedMediaUrl || post.mediaUrl;

    try {
        let externalPostId = '';
        let externalUrl = '';

        if (socialAccount.platform === 'youtube') {
            const ytRes = await uploadShort({
                account: socialAccount,
                videoUrl: effectiveMediaUrl,
                title: project.productName || 'AI UGC Video Ad',
                description: post.caption,
                privacy: 'public',
            });
            externalPostId = ytRes.videoId;
            externalUrl = ytRes.videoUrl;
        } else if (socialAccount.platform === 'facebook') {
            if (post.mediaType === 'video') {
                const fbRes = await postFacebookVideo({
                    account: socialAccount,
                    mediaUrl: effectiveMediaUrl,
                    caption: post.caption,
                });
                externalPostId = fbRes.postId;
                externalUrl = fbRes.postUrl;
            } else {
                const fbRes = await postFacebookPhoto({
                    account: socialAccount,
                    mediaUrl: effectiveMediaUrl,
                    caption: post.caption,
                });
                externalPostId = fbRes.postId;
                externalUrl = fbRes.postUrl;
            }
        } else if (socialAccount.platform === 'instagram') {
            const igRes = await publishInstagram({
                account: socialAccount,
                mediaType: post.mediaType as any,
                mediaUrl: effectiveMediaUrl,
                caption: post.caption,
                aspectRatio: project.aspectRatio,
            });
            externalPostId = igRes.mediaId;
            externalUrl = igRes.permalink;
        } else {
            throw new Error(`Unsupported platform: ${socialAccount.platform}`);
        }

        // Success: Mark as published
        await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
                status: 'published',
                externalPostId,
                externalUrl,
                error: null,
            },
        });

        logger.info('[Scheduler] Post successfully published', {
            postId: post.id,
            externalUrl,
        });
    } catch (publishErr: any) {
        logger.error('[Scheduler] Error publishing scheduled post', {
            postId: post.id,
            platform: socialAccount.platform,
            error: publishErr.message,
        });

        // Check if unrecoverable authorization failure
        if (isAuthRevokedError(publishErr)) {
            logger.warn('[Scheduler] Auth revoked error, marking account needsReconnect', {
                accountId: socialAccount.id,
                postId: post.id,
            });

            await prisma.socialAccount.update({
                where: { id: socialAccount.id },
                data: { needsReconnect: true },
            });

            await prisma.scheduledPost.update({
                where: { id: post.id },
                data: {
                    status: 'failed',
                    error: `Authentication failed: ${publishErr.message}. Please reconnect your account.`,
                },
            });
            return;
        }

        // Retry with exponential backoff if attempts < 3
        const nextAttempts = post.attempts + 1;
        if (nextAttempts < 3) {
            const backoffMs = Math.pow(2, nextAttempts) * 60 * 1000; // 2m, 4m
            const nextScheduled = new Date(Date.now() + backoffMs);

            await prisma.scheduledPost.update({
                where: { id: post.id },
                data: {
                    status: 'scheduled',
                    scheduledFor: nextScheduled,
                    attempts: nextAttempts,
                    error: publishErr.message,
                },
            });

            logger.info('[Scheduler] Scheduled post retry with backoff', {
                postId: post.id,
                nextAttempts,
                nextScheduled: nextScheduled.toISOString(),
            });
        } else {
            await prisma.scheduledPost.update({
                where: { id: post.id },
                data: {
                    status: 'failed',
                    attempts: nextAttempts,
                    error: `Failed after 3 attempts: ${publishErr.message}`,
                },
            });

            logger.error('[Scheduler] Post failed permanently after 3 attempts', {
                postId: post.id,
            });
        }
    }
}

/**
 * Main publisher cycle running every minute:
 * 1. Reaps zombie posts stuck in 'publishing'
 * 2. Claims due scheduled posts atomically and processes them
 */
export async function runPublisherCycle(): Promise<void> {
    if (isProcessing) {
        logger.debug('[Scheduler] Previous publisher cycle is still in progress, skipping tick');
        return;
    }

    isProcessing = true;

    try {
        // Step 1: Run zombie reaper
        await reapZombies();

        // Step 2: Query due posts
        const now = new Date();
        const duePosts = await prisma.scheduledPost.findMany({
            where: {
                status: 'scheduled',
                scheduledFor: { lte: now },
            },
            include: {
                socialAccount: true,
                project: true,
            },
            take: 10, // process in batches of 10
            orderBy: { scheduledFor: 'asc' },
        });

        if (duePosts.length > 0) {
            logger.info('[Scheduler] Found due scheduled posts to process', {
                count: duePosts.length,
            });
        }

        // Step 3: Atomically claim and execute each post
        for (const post of duePosts) {
            // Atomic update check: Only claim if status is still 'scheduled'
            const claimResult = await prisma.scheduledPost.updateMany({
                where: {
                    id: post.id,
                    status: 'scheduled',
                },
                data: {
                    status: 'publishing',
                    updatedAt: new Date(),
                },
            });

            // If count === 0, another concurrent worker already claimed this post
            if (claimResult.count === 0) {
                logger.debug('[Scheduler] Post already claimed by another worker, skipping', {
                    postId: post.id,
                });
                continue;
            }

            // Execute publish
            await publishPostItem(post);
        }
    } catch (cycleErr: any) {
        logger.error('[Scheduler] Unexpected error in publisher cycle', {
            error: cycleErr.message,
            stack: cycleErr.stack,
        });
        Sentry.captureException(cycleErr);
    } finally {
        isProcessing = false;
    }
}

/**
 * Starts the publisher background cron job.
 * Executes once every 60 seconds.
 */
export function startPublisherCron(): void {
    if (cronTask) {
        logger.warn('[Scheduler] Publisher cron is already running');
        return;
    }

    logger.info('[Scheduler] Initializing social publisher cron job (every 60 seconds)');

    // Schedule: every minute (* * * * *)
    cronTask = cron.schedule('* * * * *', async () => {
        await runPublisherCycle();
    });

    // Also trigger an immediate check on startup
    runPublisherCycle().catch(err => {
        logger.error('[Scheduler] Startup publisher cycle error', { error: err.message });
    });
}

/**
 * Gracefully stops the publisher cron task.
 */
export function stopPublisherCron(): void {
    if (cronTask) {
        logger.info('[Scheduler] Stopping publisher cron job');
        cronTask.stop();
        cronTask = null;
    }
}
