import { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import axios from 'axios';
import { prisma } from '../configs/prisma.js';
import logger from '../configs/logger.js';
import * as Sentry from '@sentry/node';
import { signState, verifyState } from '../utils/oauthState.js';
import { encrypt } from '../utils/crypto.js';
import { getChannelInfo, uploadShort } from '../services/social/youtube.js';
import { 
    exchangeMetaCodeForLongLivedToken, 
    getMetaPagesAndInstagramAccounts,
    postFacebookPhoto,
    postFacebookVideo,
    publishInstagram,
} from '../services/social/meta.js';
import { canPostTo } from '../services/social/validator.js';
import { generateContentWithFallback } from '../configs/ai.js';

/**
 * GET /api/social/accounts
 * List all connected social accounts for the authenticated user (omits tokens).
 */
export const getConnectedAccounts = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const accounts = await prisma.socialAccount.findMany({
            where: { userId },
            select: {
                id: true,
                platform: true,
                externalId: true,
                displayName: true,
                needsReconnect: true,
                tokenExpiresAt: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ accounts });
    } catch (error: any) {
        logger.error('[getConnectedAccounts] Failed to fetch accounts', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to retrieve social accounts' });
    }
};

/**
 * DELETE /api/social/accounts/:id
 * Disconnects a social account (scoped to authenticated user).
 */
export const disconnectAccount = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { id } = req.params;

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const account = await prisma.socialAccount.findFirst({
            where: { id, userId }
        });

        if (!account) {
            return res.status(404).json({ message: 'Account not found or access denied' });
        }

        await prisma.socialAccount.delete({
            where: { id }
        });

        logger.info('[disconnectAccount] Social account disconnected', {
            userId,
            accountId: id,
            platform: account.platform,
        });

        res.json({ message: 'Social account disconnected successfully' });
    } catch (error: any) {
        logger.error('[disconnectAccount] Failed to disconnect account', {
            userId,
            accountId: id,
            error: error.message,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to disconnect account' });
    }
};

/**
 * Returns primary frontend client origin for redirects.
 */
function getClientBaseUrl(): string {
    const configured = (process.env.CLIENT_URL || '')
        .split(',')
        .map(u => u.trim().replace(/\/$/, ''))
        .filter(Boolean);
    return configured[0] || 'http://localhost:5173';
}

/**
 * Returns server redirect URI registered in Google Cloud Console.
 */
function getYoutubeRedirectUri(): string {
    const serverUrl = (process.env.SERVER_PUBLIC_URL || 'http://localhost:5001').replace(/\/$/, '');
    return `${serverUrl}/api/social/callback/youtube`;
}

/**
 * GET /api/social/connect/youtube (authed)
 * Returns the Google OAuth 2.0 authorization URL for YouTube.
 */
export const getYoutubeAuthUrl = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
        logger.error('[getYoutubeAuthUrl] Missing GOOGLE_OAUTH_CLIENT_ID');
        return res.status(500).json({ message: 'Google OAuth client ID is not configured on server' });
    }

    try {
        const state = signState(userId, 'youtube');
        const redirectUri = getYoutubeRedirectUri();

        const scopes = [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly',
        ].join(' ');

        const authParams = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: scopes,
            access_type: 'offline',
            prompt: 'consent',
            state,
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;

        logger.info('[getYoutubeAuthUrl] Generated YouTube OAuth URL', {
            userId,
            redirectUri,
        });

        res.json({ authUrl });
    } catch (error: any) {
        logger.error('[getYoutubeAuthUrl] Failed to generate OAuth URL', {
            userId,
            error: error.message,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to initialize YouTube connection' });
    }
};

/**
 * GET /api/social/callback/youtube (unauthenticated browser redirect)
 * Validates state, exchanges authorization code, stores encrypted tokens,
 * and redirects to client frontend /accounts?connected=youtube.
 */
export const handleYoutubeCallback = async (req: Request, res: Response) => {
    const clientBaseUrl = getClientBaseUrl();
    const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

    logger.info('[handleYoutubeCallback] Received YouTube OAuth callback', {
        hasCode: !!code,
        hasState: !!state,
        oauthError,
    });

    if (oauthError) {
        logger.warn('[handleYoutubeCallback] OAuth access denied by user or Google', { oauthError });
        return res.redirect(`${clientBaseUrl}/accounts?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
        logger.warn('[handleYoutubeCallback] Missing code or state parameters');
        return res.redirect(`${clientBaseUrl}/accounts?error=missing_code_or_state`);
    }

    // Verify HMAC-signed state token
    const verified = verifyState(state);
    if (!verified || verified.platform !== 'youtube') {
        logger.warn('[handleYoutubeCallback] Invalid or expired OAuth state token', { state });
        return res.redirect(`${clientBaseUrl}/accounts?error=invalid_or_expired_state`);
    }

    const { userId } = verified;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = getYoutubeRedirectUri();

    if (!clientId || !clientSecret) {
        logger.error('[handleYoutubeCallback] Missing Google OAuth credentials');
        return res.redirect(`${clientBaseUrl}/accounts?error=server_configuration_error`);
    }

    try {
        // Exchange authorization code for tokens
        const tokenRes = await axios.post<{
            access_token: string;
            refresh_token?: string;
            expires_in: number;
        }>(
            'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000,
            }
        );

        const { access_token, refresh_token, expires_in } = tokenRes.data;
        const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

        // Fetch channel info
        const channel = await getChannelInfo(access_token);

        // Encrypt tokens
        const encryptedAccessToken = encrypt(access_token);
        const encryptedRefreshToken = refresh_token ? encrypt(refresh_token) : null;

        // Upsert SocialAccount
        await prisma.socialAccount.upsert({
            where: {
                userId_platform_externalId: {
                    userId,
                    platform: 'youtube',
                    externalId: channel.id,
                },
            },
            update: {
                displayName: channel.title,
                encryptedAccessToken,
                ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
                tokenExpiresAt,
                needsReconnect: false,
            },
            create: {
                userId,
                platform: 'youtube',
                externalId: channel.id,
                displayName: channel.title,
                encryptedAccessToken,
                encryptedRefreshToken,
                tokenExpiresAt,
                needsReconnect: false,
            },
        });

        logger.info('[handleYoutubeCallback] YouTube account connected successfully', {
            userId,
            channelId: channel.id,
            channelTitle: channel.title,
        });

        res.redirect(`${clientBaseUrl}/accounts?connected=youtube`);
    } catch (error: any) {
        const errorData = error?.response?.data;
        logger.error('[handleYoutubeCallback] Failed exchanging code or saving account', {
            userId,
            error: errorData || error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);

        const errorParam = errorData?.error_description || errorData?.error || error.message || 'connection_failed';
        res.redirect(`${clientBaseUrl}/accounts?error=${encodeURIComponent(errorParam)}`);
    }
};

/**
 * Returns server redirect URI registered in Meta App Dashboard.
 */
function getMetaRedirectUri(): string {
    const serverUrl = (process.env.SERVER_PUBLIC_URL || 'http://localhost:5001').replace(/\/$/, '');
    return `${serverUrl}/api/social/callback/meta`;
}

/**
 * GET /api/social/connect/meta (authed)
 * Returns the Facebook OAuth authorization URL requesting Facebook Page and Instagram Publishing permissions.
 */
export const getMetaAuthUrl = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const appId = process.env.META_APP_ID;
    if (!appId) {
        logger.error('[getMetaAuthUrl] Missing META_APP_ID');
        return res.status(500).json({ message: 'Meta App ID is not configured on server' });
    }

    try {
        const state = signState(userId, 'facebook');
        const redirectUri = getMetaRedirectUri();

        const scopes = [
            'pages_show_list',
            'pages_read_engagement',
            'pages_manage_posts',
            'instagram_basic',
            'instagram_content_publish',
        ].join(',');

        const authParams = new URLSearchParams({
            client_id: appId,
            redirect_uri: redirectUri,
            state,
            scope: scopes,
            response_type: 'code',
            auth_type: 'reauthorize',   // force full re-consent including pages permission
        });

        const authUrl = `https://www.facebook.com/v20.0/dialog/oauth?${authParams.toString()}`;

        logger.info('[getMetaAuthUrl] Generated Meta OAuth URL', {
            userId,
            redirectUri,
        });

        res.json({ authUrl });
    } catch (error: any) {
        logger.error('[getMetaAuthUrl] Failed to generate Meta OAuth URL', {
            userId,
            error: error.message,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to initialize Meta connection' });
    }
};

/**
 * GET /api/social/callback/meta (unauthenticated browser redirect)
 * Validates state, exchanges code for long-lived user token, discovers managed pages
 * and linked Instagram accounts, saves encrypted Page tokens, and redirects back to frontend.
 */
export const handleMetaCallback = async (req: Request, res: Response) => {
    const clientBaseUrl = getClientBaseUrl();
    const { code, state, error: oauthError, error_description } = req.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
    };

    logger.info('[handleMetaCallback] Received Meta OAuth callback', {
        hasCode: !!code,
        hasState: !!state,
        oauthError,
    });

    if (oauthError) {
        logger.warn('[handleMetaCallback] OAuth access denied by user or Meta', { oauthError, error_description });
        return res.redirect(`${clientBaseUrl}/accounts?error=${encodeURIComponent(error_description || oauthError)}`);
    }

    if (!code || !state) {
        logger.warn('[handleMetaCallback] Missing code or state parameters');
        return res.redirect(`${clientBaseUrl}/accounts?error=missing_code_or_state`);
    }

    // Verify HMAC-signed state token
    const verified = verifyState(state);
    if (!verified || verified.platform !== 'facebook') {
        logger.warn('[handleMetaCallback] Invalid or expired OAuth state token', { state });
        return res.redirect(`${clientBaseUrl}/accounts?error=invalid_or_expired_state`);
    }

    const { userId } = verified;
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = getMetaRedirectUri();

    if (!appId || !appSecret) {
        logger.error('[handleMetaCallback] Missing Meta credentials (META_APP_ID / META_APP_SECRET)');
        return res.redirect(`${clientBaseUrl}/accounts?error=server_configuration_error`);
    }

    try {
        // Exchange code for long-lived user access token
        const { accessToken: userAccessToken } = await exchangeMetaCodeForLongLivedToken({
            code,
            clientId: appId,
            clientSecret: appSecret,
            redirectUri,
        });

        // Fetch user's managed Pages with Page access tokens and linked Instagram accounts
        const pages = await getMetaPagesAndInstagramAccounts(userAccessToken);

        // Even if no pages found, try to save the user token directly for Instagram
        // (Instagram Basic Display / user token can still work for some cases)
        if (pages.length === 0) {
            logger.warn('[handleMetaCallback] No Facebook Pages found — attempting to save user-level token for Instagram', { userId });

            // Try to get Instagram account linked to this user token directly
            try {
                const igRes = await axios.get(`https://graph.facebook.com/v20.0/me`, {
                    params: {
                        fields: 'id,name,instagram_business_account{id,username,name}',
                        access_token: userAccessToken,
                    },
                    timeout: 15000,
                });
                logger.info('[handleMetaCallback] Direct user IG check', { rawResponse: JSON.stringify(igRes.data) });

                const igAccount = igRes.data?.instagram_business_account;
                if (igAccount) {
                    const encryptedToken = encrypt(userAccessToken);
                    const igDisplayName = igAccount.username ? `@${igAccount.username}` : (igAccount.name || 'Instagram Account');

                    await prisma.socialAccount.upsert({
                        where: { userId_platform_externalId: { userId, platform: 'instagram', externalId: igAccount.id } },
                        update: { displayName: igDisplayName, encryptedAccessToken: encryptedToken, needsReconnect: false },
                        create: { userId, platform: 'instagram', externalId: igAccount.id, displayName: igDisplayName, encryptedAccessToken: encryptedToken, needsReconnect: false },
                    });

                    logger.info('[handleMetaCallback] Saved Instagram account via user token', { userId, igAccount });
                    return res.redirect(`${clientBaseUrl}/accounts?connected=meta&pages=0&instagram=1`);
                }
            } catch (igErr: any) {
                logger.warn('[handleMetaCallback] Could not fetch Instagram via user token', { error: igErr.message });
            }

            logger.warn('[handleMetaCallback] User has no managed Facebook Pages', { userId });
            return res.redirect(`${clientBaseUrl}/accounts?error=no_facebook_pages_found`);
        }

        let savedPagesCount = 0;
        let savedIgCount = 0;

        for (const page of pages) {
            const encryptedPageToken = encrypt(page.access_token);

            // Upsert Facebook Page SocialAccount
            await prisma.socialAccount.upsert({
                where: {
                    userId_platform_externalId: {
                        userId,
                        platform: 'facebook',
                        externalId: page.id,
                    },
                },
                update: {
                    displayName: page.name,
                    encryptedAccessToken: encryptedPageToken,
                    needsReconnect: false,
                },
                create: {
                    userId,
                    platform: 'facebook',
                    externalId: page.id,
                    displayName: page.name,
                    encryptedAccessToken: encryptedPageToken,
                    needsReconnect: false,
                },
            });
            savedPagesCount++;

            // If this page has a connected Instagram Business Account, save it
            if (page.instagram_business_account) {
                const igAccount = page.instagram_business_account;
                const igDisplayName = igAccount.username ? `@${igAccount.username}` : (igAccount.name || 'Instagram Account');

                // Instagram Content Publishing uses the parent Page's access token
                await prisma.socialAccount.upsert({
                    where: {
                        userId_platform_externalId: {
                            userId,
                            platform: 'instagram',
                            externalId: igAccount.id,
                        },
                    },
                    update: {
                        displayName: igDisplayName,
                        encryptedAccessToken: encryptedPageToken,
                        needsReconnect: false,
                    },
                    create: {
                        userId,
                        platform: 'instagram',
                        externalId: igAccount.id,
                        displayName: igDisplayName,
                        encryptedAccessToken: encryptedPageToken,
                        needsReconnect: false,
                    },
                });
                savedIgCount++;
            }
        }

        logger.info('[handleMetaCallback] Meta accounts connected successfully', {
            userId,
            savedPagesCount,
            savedIgCount,
        });

        res.redirect(`${clientBaseUrl}/accounts?connected=meta&pages=${savedPagesCount}&instagram=${savedIgCount}`);
    } catch (error: any) {
        const errorData = error?.response?.data?.error;
        logger.error('[handleMetaCallback] Failed exchanging code or saving Meta accounts', {
            userId,
            error: errorData || error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);

        const errorParam = errorData?.message || error.message || 'meta_connection_failed';
        res.redirect(`${clientBaseUrl}/accounts?error=${encodeURIComponent(errorParam)}`);
    }
};

/**
 * POST /api/social/meta/select (authed)
 * Optional endpoint allowing users to pick which specific Facebook Pages to retain.
 */
export const selectMetaAccounts = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { retainedExternalIds } = req.body as { retainedExternalIds: string[] };

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!Array.isArray(retainedExternalIds)) {
        return res.status(400).json({ message: 'retainedExternalIds must be an array of IDs' });
    }

    try {
        // Delete accounts belonging to this user on Meta platforms that are not in the retained list
        const deleteResult = await prisma.socialAccount.deleteMany({
            where: {
                userId,
                platform: { in: ['facebook', 'instagram'] },
                externalId: { notIn: retainedExternalIds },
            },
        });

        logger.info('[selectMetaAccounts] Updated retained Meta accounts', {
            userId,
            retainedCount: retainedExternalIds.length,
            removedCount: deleteResult.count,
        });

        res.json({
            message: 'Updated selected accounts',
            retainedCount: retainedExternalIds.length,
            removedCount: deleteResult.count,
        });
    } catch (error: any) {
        logger.error('[selectMetaAccounts] Failed updating selected accounts', {
            userId,
            error: error.message,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to update selected accounts' });
    }
};

/**
 * POST /api/social/caption (authed)
 * Generates an AI-optimized caption and hashtags using Gemini with fallback.
 */
export const generateCaption = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { projectId, platform, tone = 'engaging and authentic' } = req.body;

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!projectId || !platform) {
        return res.status(400).json({ message: 'projectId and platform are required' });
    }

    try {
        const project = await prisma.project.findFirst({
            where: { id: projectId, userId },
        });

        if (!project) {
            return res.status(404).json({ message: 'Project not found or unauthorized' });
        }

        const prompt = `You are an elite UGC (User-Generated Content) social media copywriter.
Generate a high-converting, authentic social media post caption and hashtags for the following product:

Product Name: ${project.productName}
Product Description: ${project.productDescription || 'High-quality consumer product'}
User Creative Prompt: ${project.userPrompt || 'Professional advertisement shoot'}
Target Platform: ${platform.toUpperCase()}
Narration Language: ${project.language || 'English'}
Requested Tone: ${tone}

Platform-specific constraints:
- Instagram: Include an attention-grabbing hook, 2-3 engaging body lines, clear call to action, and 8-12 targeted hashtags. Max 1,500 characters.
- YouTube Shorts: Punchy, short title & description with natural search keywords, ending with #Shorts. Max 400 characters.
- Facebook: Relatable conversational storytelling with a direct call to action and 3-5 hashtags. Max 800 characters.

OUTPUT STRICTLY IN JSON FORMAT matching this schema without markdown fences:
{
  "caption": "string containing full post text without hashtags",
  "hashtags": ["#tag1", "#tag2", "#tag3"]
}`;

        const aiResponse = await generateContentWithFallback({
            model: 'gemini-3.1-flash-image-preview',
            contents: [{ text: prompt }],
            config: {
                temperature: 0.7,
                responseMimeType: 'application/json',
            },
        }, 'socialController.generateCaption');

        let rawText = aiResponse.text?.trim() || '{}';
        // Strip code fence if returned
        if (rawText.startsWith('```json')) rawText = rawText.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (rawText.startsWith('```')) rawText = rawText.replace(/^```/, '').replace(/```$/, '').trim();

        const parsed = JSON.parse(rawText);

        res.json({
            caption: parsed.caption || '',
            hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
        });
    } catch (error: any) {
        logger.error('[generateCaption] Failed generating AI caption', {
            userId,
            projectId,
            error: error.message,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to generate AI caption. Please try again.' });
    }
};

/**
 * Shared dispatcher to publish to target social platform
 */
async function executeSocialPublish(params: {
    account: any;
    mediaType: 'image' | 'video';
    mediaUrl: string;
    caption: string;
    aspectRatio: string;
    productName: string;
}): Promise<{ externalPostId: string; externalUrl: string }> {
    const { account, mediaType, mediaUrl, caption, aspectRatio, productName } = params;

    if (account.platform === 'youtube') {
        const result = await uploadShort({
            account,
            videoUrl: mediaUrl,
            title: productName || 'AI UGC Video Ad',
            description: caption,
            privacy: 'public',
        });
        return {
            externalPostId: result.videoId,
            externalUrl: result.videoUrl,
        };
    }

    if (account.platform === 'facebook') {
        if (mediaType === 'video') {
            const result = await postFacebookVideo({
                account,
                mediaUrl,
                caption,
            });
            return {
                externalPostId: result.postId,
                externalUrl: result.postUrl,
            };
        } else {
            const result = await postFacebookPhoto({
                account,
                mediaUrl,
                caption,
            });
            return {
                externalPostId: result.postId,
                externalUrl: result.postUrl,
            };
        }
    }

    if (account.platform === 'instagram') {
        const result = await publishInstagram({
            account,
            mediaType,
            mediaUrl,
            caption,
            aspectRatio,
        });
        return {
            externalPostId: result.mediaId,
            externalUrl: result.permalink,
        };
    }

    throw new Error(`Unsupported platform: ${account.platform}`);
}

/**
 * POST /api/social/post (authed)
 * Creates a social post. If scheduledFor is provided, stores as scheduled.
 * Otherwise immediately publishes to the destination platform.
 */
export const createSocialPost = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { projectId, socialAccountId, mediaUrl, caption, aiDisclosure, scheduledFor } = req.body;

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!projectId || !socialAccountId || !mediaUrl) {
        return res.status(400).json({ message: 'projectId, socialAccountId, and mediaUrl are required' });
    }

    try {
        // Validate Project ownership
        const project = await prisma.project.findFirst({
            where: { id: projectId, userId },
        });

        if (!project) {
            return res.status(404).json({ message: 'Project not found or unauthorized' });
        }

        // Validate Social Account ownership
        const account = await prisma.socialAccount.findFirst({
            where: { id: socialAccountId, userId },
        });

        if (!account) {
            return res.status(404).json({ message: 'Social account not found or unauthorized' });
        }

        // Validate mediaUrl belongs to this project
        const validMediaUrls = [
            project.generatedImage,
            ...(project.generatedImages || []),
            project.generatedVideo,
            ...(project.uploadedImages || []),
        ].filter(Boolean);

        const isAuthorizedMedia = validMediaUrls.some(u => u === mediaUrl || mediaUrl.includes(u.split('/').pop() || ''));
        if (!isAuthorizedMedia) {
            return res.status(400).json({ message: 'The provided mediaUrl does not belong to this project' });
        }

        // Determine media type
        const isVideo = mediaUrl === project.generatedVideo || mediaUrl.endsWith('.mp4');
        const mediaType: 'image' | 'video' = isVideo ? 'video' : 'image';

        // Validate that mediaUrl is hosted on Cloudinary
        try {
            const parsedMediaUrl = new URL(mediaUrl);
            if (!parsedMediaUrl.hostname.includes('cloudinary.com') && !parsedMediaUrl.hostname.includes('res.cloudinary.com')) {
                return res.status(400).json({ message: 'mediaUrl must be a secure Cloudinary asset URL' });
            }
        } catch {
            return res.status(400).json({ message: 'Invalid mediaUrl format' });
        }

        // Check format compatibility
        const validation = canPostTo(account.platform as any, mediaType, project.aspectRatio, mediaUrl);
        if (!validation.canPost) {
            return res.status(400).json({
                message: validation.reason || 'This media format is not supported on the selected platform',
            });
        }

        // Format caption with AI Disclosure if opted in
        let finalCaption = (caption || '').trim();
        if (aiDisclosure) {
            finalCaption = `${finalCaption}\n\n✨ AI Disclosure: Generated with Vigyapan AI`.trim();
        }

        // Platform-specific caption length constraints
        if (account.platform === 'instagram' && finalCaption.length > 2200) {
            return res.status(400).json({
                message: `Instagram caption exceeds the maximum allowed length of 2,200 characters (current length: ${finalCaption.length})`,
            });
        }
        if (account.platform === 'facebook' && finalCaption.length > 5000) {
            return res.status(400).json({
                message: `Facebook caption exceeds the maximum allowed length of 5,000 characters (current length: ${finalCaption.length})`,
            });
        }
        if (account.platform === 'youtube' && finalCaption.length > 5000) {
            return res.status(400).json({
                message: `YouTube Shorts description exceeds the maximum allowed length of 5,000 characters (current length: ${finalCaption.length})`,
            });
        }

        // Case 1: Post is Scheduled for the Future
        if (scheduledFor) {
            const scheduledDate = new Date(scheduledFor);
            const now = Date.now();

            if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= now) {
                return res.status(400).json({ message: 'scheduledFor must be a valid future datetime' });
            }

            // Max 90 days in advance
            if (scheduledDate.getTime() > now + 90 * 24 * 60 * 60 * 1000) {
                return res.status(400).json({ message: 'Posts cannot be scheduled more than 90 days in advance' });
            }

            const post = await prisma.scheduledPost.create({
                data: {
                    userId,
                    projectId,
                    socialAccountId,
                    mediaType,
                    mediaUrl,
                    caption: finalCaption,
                    aiDisclosure: !!aiDisclosure,
                    scheduledFor: scheduledDate,
                    status: 'scheduled',
                },
                include: {
                    socialAccount: { select: { platform: true, displayName: true } },
                },
            });

            logger.info('[createSocialPost] Post scheduled successfully', {
                userId,
                postId: post.id,
                scheduledFor: scheduledDate.toISOString(),
            });

            return res.status(201).json({
                post,
                message: 'Post scheduled successfully!',
            });
        }

        // Case 2: Post Now (Immediate Publishing)
        logger.info('[createSocialPost] Publishing post immediately', {
            userId,
            platform: account.platform,
            mediaType,
        });

        // Create row in 'publishing' status
        const post = await prisma.scheduledPost.create({
            data: {
                userId,
                projectId,
                socialAccountId,
                mediaType,
                mediaUrl,
                caption: finalCaption,
                aiDisclosure: !!aiDisclosure,
                status: 'publishing',
                attempts: 1,
            },
        });

        try {
            const published = await executeSocialPublish({
                account,
                mediaType,
                mediaUrl: validation.transformedMediaUrl || mediaUrl,
                caption: finalCaption,
                aspectRatio: project.aspectRatio,
                productName: project.productName,
            });

            const updatedPost = await prisma.scheduledPost.update({
                where: { id: post.id },
                data: {
                    status: 'published',
                    externalPostId: published.externalPostId,
                    externalUrl: published.externalUrl,
                    error: null,
                },
                include: {
                    socialAccount: { select: { platform: true, displayName: true } },
                },
            });

            logger.info('[createSocialPost] Post published successfully', {
                postId: post.id,
                externalUrl: published.externalUrl,
            });

            return res.status(200).json({
                post: updatedPost,
                message: 'Published successfully!',
            });
        } catch (publishErr: any) {
            await prisma.scheduledPost.update({
                where: { id: post.id },
                data: {
                    status: 'failed',
                    error: publishErr.message,
                },
            });

            logger.error('[createSocialPost] Immediate publishing failed', {
                postId: post.id,
                error: publishErr.message,
            });

            return res.status(500).json({
                message: `Publishing failed: ${publishErr.message}`,
            });
        }
    } catch (error: any) {
        logger.error('[createSocialPost] Request error', {
            userId,
            error: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: error.message || 'Failed to create social post' });
    }
};

/**
 * GET /api/social/posts (authed)
 * Retrieves user's post history.
 */
export const getSocialPosts = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const posts = await prisma.scheduledPost.findMany({
            where: { userId },
            include: {
                socialAccount: {
                    select: {
                        platform: true,
                        displayName: true,
                    },
                },
                project: {
                    select: {
                        name: true,
                        productName: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ posts });
    } catch (error: any) {
        logger.error('[getSocialPosts] Failed retrieving posts', {
            userId,
            error: error.message,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to retrieve post history' });
    }
};

/**
 * POST /api/social/posts/:id/retry (authed)
 * Retries a failed post.
 */
export const retrySocialPost = async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { id } = req.params;

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const post = await prisma.scheduledPost.findFirst({
            where: { id, userId },
            include: {
                socialAccount: true,
                project: true,
            },
        });

        if (!post) {
            return res.status(404).json({ message: 'Post not found or unauthorized' });
        }

        if (post.status === 'published') {
            return res.status(400).json({ message: 'Post has already been published' });
        }

        await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
                status: 'publishing',
                attempts: { increment: 1 },
            },
        });

        try {
            const validation = canPostTo(
                post.socialAccount.platform as any,
                post.mediaType as any,
                post.project.aspectRatio,
                post.mediaUrl
            );

            const published = await executeSocialPublish({
                account: post.socialAccount,
                mediaType: post.mediaType as any,
                mediaUrl: validation.transformedMediaUrl || post.mediaUrl,
                caption: post.caption,
                aspectRatio: post.project.aspectRatio,
                productName: post.project.productName,
            });

            const updated = await prisma.scheduledPost.update({
                where: { id: post.id },
                data: {
                    status: 'published',
                    externalPostId: published.externalPostId,
                    externalUrl: published.externalUrl,
                    error: null,
                },
                include: {
                    socialAccount: { select: { platform: true, displayName: true } },
                },
            });

            logger.info('[retrySocialPost] Retry succeeded', {
                postId: post.id,
                externalUrl: published.externalUrl,
            });

            return res.json({
                post: updated,
                message: 'Post published successfully!',
            });
        } catch (publishErr: any) {
            await prisma.scheduledPost.update({
                where: { id: post.id },
                data: {
                    status: 'failed',
                    error: publishErr.message,
                },
            });

            return res.status(500).json({
                message: `Retry failed: ${publishErr.message}`,
            });
        }
    } catch (error: any) {
        logger.error('[retrySocialPost] Server error', {
            userId,
            postId: id,
            error: error.message,
        });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Failed to retry post' });
    }
};
