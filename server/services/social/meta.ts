import axios from 'axios';
import { prisma } from '../../configs/prisma.js';
import { decrypt } from '../../utils/crypto.js';
import logger from '../../configs/logger.js';
import { optimizeForInstagramImage, optimizeForInstagramVideo } from './validator.js';

const META_GRAPH_VERSION = 'v20.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface MetaPostParams {
    account: {
        id: string;
        userId: string;
        externalId: string;
        displayName: string;
        encryptedAccessToken: string;
    };
    mediaUrl: string;
    caption: string;
}

export interface InstagramPublishParams {
    account: {
        id: string;
        userId: string;
        externalId: string;
        displayName: string;
        encryptedAccessToken: string;
    };
    mediaType: 'image' | 'video';
    mediaUrl: string;
    caption: string;
}

export interface MetaPageAccount {
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: {
        id: string;
        username: string;
        name?: string;
    };
}

/**
 * Retrieves and decrypts the stored Page/IG access token.
 */
export function getMetaAccessToken(account: { encryptedAccessToken: string }): string {
    return decrypt(account.encryptedAccessToken);
}

/**
 * Exchanges an OAuth authorization code for a long-lived user access token.
 */
export async function exchangeMetaCodeForLongLivedToken(params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}): Promise<{ accessToken: string; expiresIn?: number }> {
    const { code, clientId, clientSecret, redirectUri } = params;

    logger.info('[Meta Service] Exchanging authorization code for short-lived token');

    // Step 1: Exchange code for short-lived user token
    const shortTokenRes = await axios.get(`${GRAPH_BASE_URL}/oauth/access_token`, {
        params: {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
        },
        timeout: 15000,
    });

    const shortToken = shortTokenRes.data.access_token;
    if (!shortToken) {
        throw new Error('Meta did not return a short-lived access token');
    }

    // Step 2: Exchange for long-lived user token (valid for ~60 days)
    logger.info('[Meta Service] Exchanging short-lived token for long-lived user token');
    const longTokenRes = await axios.get(`${GRAPH_BASE_URL}/oauth/access_token`, {
        params: {
            grant_type: 'fb_exchange_token',
            client_id: clientId,
            client_secret: clientSecret,
            fb_exchange_token: shortToken,
        },
        timeout: 15000,
    });

    return {
        accessToken: longTokenRes.data.access_token || shortToken,
        expiresIn: longTokenRes.data.expires_in,
    };
}

/**
 * Fetches all Facebook Pages and linked Instagram Business accounts managed by the user.
 */
export async function getMetaPagesAndInstagramAccounts(userAccessToken: string): Promise<MetaPageAccount[]> {
    logger.info('[Meta Service] Fetching user managed pages and linked Instagram accounts');

    // Debug: check what permissions were actually granted
    try {
        const permRes = await axios.get(`${GRAPH_BASE_URL}/me/permissions`, {
            headers: { Authorization: `Bearer ${userAccessToken}` },
            timeout: 10000,
        });
        logger.info('[Meta Service] Granted permissions', { permissions: JSON.stringify(permRes.data) });
    } catch (e: any) {
        logger.warn('[Meta Service] Could not fetch permissions', { error: e.message });
    }

    const response = await axios.get(`${GRAPH_BASE_URL}/me/accounts`, {
        params: {
            fields: 'id,name,access_token,instagram_business_account{id,username,name}',
        },
        headers: {
            Authorization: `Bearer ${userAccessToken}`,
        },
        timeout: 20000,
    });

    const pages = response.data?.data || [];
    logger.info('[Meta Service] Discovered managed pages', {
        pageCount: pages.length,
        rawResponse: JSON.stringify(response.data),
        status: response.status,
    });

    // If no pages from /me/accounts, try the expanded /me query as fallback
    if (pages.length === 0) {
        logger.info('[Meta Service] No pages from /me/accounts — trying fallback /me?fields=accounts query');
        try {
            const fallbackRes = await axios.get(`${GRAPH_BASE_URL}/me`, {
                params: {
                    fields: 'id,name,accounts{id,name,access_token,instagram_business_account{id,username,name}}',
                },
                headers: {
                    Authorization: `Bearer ${userAccessToken}`,
                },
                timeout: 20000,
            });
            logger.info('[Meta Service] Fallback /me response', {
                rawResponse: JSON.stringify(fallbackRes.data),
            });
            const fallbackPages = fallbackRes.data?.accounts?.data || [];
            if (fallbackPages.length > 0) {
                logger.info('[Meta Service] Found pages via fallback endpoint', { pageCount: fallbackPages.length });
                return fallbackPages;
            }
        } catch (fallbackErr: any) {
            logger.warn('[Meta Service] Fallback /me query also failed', { error: fallbackErr.message });
        }

        // Last resort: try fetching page directly by known page IDs in env
        // This handles the Meta dev-mode bug where /me/accounts returns [] even with pages_show_list granted
        logger.info('[Meta Service] Trying direct page token fetch for known page ID');
        try {
            const knownPageId = process.env.META_TEST_PAGE_ID;
            if (knownPageId) {
                const directPageRes = await axios.get(`${GRAPH_BASE_URL}/${knownPageId}`, {
                    params: {
                        fields: 'id,name,access_token,instagram_business_account{id,username,name}',
                        access_token: userAccessToken,
                    },
                    timeout: 15000,
                });
                logger.info('[Meta Service] Direct page fetch response', {
                    rawResponse: JSON.stringify(directPageRes.data),
                });
                if (directPageRes.data?.id && directPageRes.data?.access_token) {
                    return [directPageRes.data as MetaPageAccount];
                }
            }
        } catch (directErr: any) {
            logger.warn('[Meta Service] Direct page fetch also failed', { error: directErr.message });
        }
    }

    return pages;
}

/**
 * Publishes a photo to a Facebook Page using its Cloudinary URL.
 */
export async function postFacebookPhoto(params: MetaPostParams): Promise<{ postId: string; postUrl: string }> {
    const { account, mediaUrl, caption } = params;
    const pageAccessToken = getMetaAccessToken(account);

    logger.info('[Meta Service] Publishing photo to Facebook Page', {
        pageId: account.externalId,
        pageName: account.displayName,
        mediaUrl,
    });

    try {
        const response = await axios.post(
            `${GRAPH_BASE_URL}/${account.externalId}/photos`,
            {
                url: mediaUrl,
                caption: caption || '',
            },
            {
                headers: {
                    Authorization: `Bearer ${pageAccessToken}`,
                },
                timeout: 30000,
            }
        );

        const photoId = response.data?.id;
        const postId = response.data?.post_id || photoId;
        const postUrl = `https://www.facebook.com/${postId}`;

        logger.info('[Meta Service] Facebook photo published successfully', {
            photoId,
            postId,
            postUrl,
        });

        return { postId, postUrl };
    } catch (error: any) {
        const errData = error?.response?.data?.error;
        logger.error('[Meta Service] Failed publishing photo to Facebook Page', {
            error: errData || error.message,
            pageId: account.externalId,
        });

        if (errData?.code === 190 || errData?.type === 'OAuthException') {
            // code 200 = permission denied (pages_manage_posts missing), not an expired token
            if (errData?.code !== 190) {
                throw new Error(`Facebook publishing failed: ${errData?.message || 'Permission denied. Enable pages_manage_posts in Meta App Dashboard.'}`);
            }
            await prisma.socialAccount.update({
                where: { id: account.id },
                data: { needsReconnect: true },
            });
            throw new Error('Facebook authorization has expired or was revoked. Please reconnect your account.');
        }

        throw new Error(`Failed to publish photo to Facebook: ${errData?.message || error.message}`);
    }
}

/**
 * Publishes a video to a Facebook Page using its Cloudinary URL.
 */
export async function postFacebookVideo(params: MetaPostParams): Promise<{ postId: string; postUrl: string }> {
    const { account, mediaUrl, caption } = params;
    const pageAccessToken = getMetaAccessToken(account);

    logger.info('[Meta Service] Publishing video to Facebook Page', {
        pageId: account.externalId,
        pageName: account.displayName,
        mediaUrl,
    });

    try {
        const response = await axios.post(
            `${GRAPH_BASE_URL}/${account.externalId}/videos`,
            {
                file_url: mediaUrl,
                description: caption || '',
            },
            {
                headers: {
                    Authorization: `Bearer ${pageAccessToken}`,
                },
                timeout: 60000,
            }
        );

        const videoId = response.data?.id;
        const postUrl = `https://www.facebook.com/${account.externalId}/videos/${videoId}`;

        logger.info('[Meta Service] Facebook video published successfully', {
            videoId,
            postUrl,
        });

        return { postId: videoId, postUrl };
    } catch (error: any) {
        const errData = error?.response?.data?.error;
        logger.error('[Meta Service] Failed publishing video to Facebook Page', {
            error: errData || error.message,
            pageId: account.externalId,
        });

        if (errData?.code === 190 || errData?.type === 'OAuthException') {
            // code 200 = permission denied (pages_manage_posts missing), not an expired token
            if (errData?.code !== 190) {
                throw new Error(`Facebook publishing failed: ${errData?.message || 'Permission denied. Enable pages_manage_posts in Meta App Dashboard.'}`);
            }
            await prisma.socialAccount.update({
                where: { id: account.id },
                data: { needsReconnect: true },
            });
            throw new Error('Facebook authorization has expired or was revoked. Please reconnect your account.');
        }

        throw new Error(`Failed to publish video to Facebook: ${errData?.message || error.message}`);
    }
}

/**
 * Publishes an image or video/Reel to an Instagram Business account.
 * Flow:
 * 1. Prepares Cloudinary URL (pads 9:16 images to 4:5; converts video to H.264/AAC MP4)
 * 2. Creates an Instagram media container
 * 3. For video, polls container status until FINISHED (up to 5 min with 5s interval)
 * 4. Publishes container via /media_publish
 * 5. Fetches media permalink
 */
export async function publishInstagram(params: InstagramPublishParams & { aspectRatio?: string }): Promise<{ mediaId: string; permalink: string }> {
    const { account, mediaType, mediaUrl, caption, aspectRatio = '9:16' } = params;
    const pageAccessToken = getMetaAccessToken(account);
    const igUserId = account.externalId;

    logger.info('[Meta Service] Initiating Instagram publication', {
        igUserId,
        displayName: account.displayName,
        mediaType,
        aspectRatio,
        mediaUrl,
    });

    // Step 1: Optimize Cloudinary URL for Instagram requirements
    let formattedMediaUrl = mediaUrl;
    if (mediaType === 'image') {
        formattedMediaUrl = optimizeForInstagramImage(mediaUrl, aspectRatio);
    } else {
        formattedMediaUrl = optimizeForInstagramVideo(mediaUrl);
    }

    logger.debug('[Meta Service] Formatted media URL for Instagram', {
        original: mediaUrl,
        formatted: formattedMediaUrl,
    });

    // Step 2: Create media container
    let creationId: string;
    try {
        const containerPayload: any = {
            caption: caption || '',
        };

        if (mediaType === 'image') {
            containerPayload.image_url = formattedMediaUrl;
        } else {
            containerPayload.video_url = formattedMediaUrl;
            containerPayload.media_type = 'REELS';
            containerPayload.share_to_feed = true;
        }

        const containerRes = await axios.post(
            `${GRAPH_BASE_URL}/${igUserId}/media`,
            containerPayload,
            {
                headers: {
                    Authorization: `Bearer ${pageAccessToken}`,
                },
                timeout: 30000,
            }
        );

        creationId = containerRes.data?.id;
        if (!creationId) {
            throw new Error('Instagram did not return a media creation container ID');
        }

        logger.info('[Meta Service] Instagram media container created', {
            creationId,
            mediaType,
        });
    } catch (createErr: any) {
        const errData = createErr?.response?.data?.error;
        logger.error('[Meta Service] Failed creating Instagram container', {
            error: errData || createErr.message,
            igUserId,
        });

        if (errData?.code === 190 || errData?.type === 'OAuthException') {
            await prisma.socialAccount.update({
                where: { id: account.id },
                data: { needsReconnect: true },
            });
            throw new Error('Instagram authorization expired. Please reconnect your account.');
        }

        throw new Error(`Failed to create Instagram container: ${errData?.message || createErr.message}`);
    }

    // Step 3: For video, poll status_code until FINISHED
    if (mediaType === 'video') {
        logger.info('[Meta Service] Polling Instagram container status for video processing', { creationId });

        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max (60 * 5s)
        let isFinished = false;

        while (attempts < maxAttempts && !isFinished) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5-second interval

            try {
                const statusRes = await axios.get(`${GRAPH_BASE_URL}/${creationId}`, {
                    params: {
                        fields: 'status_code,status',
                    },
                    headers: {
                        Authorization: `Bearer ${pageAccessToken}`,
                    },
                    timeout: 15000,
                });

                const statusCode = statusRes.data?.status_code;
                logger.debug('[Meta Service] Container polling status', {
                    creationId,
                    attempt: attempts,
                    statusCode,
                });

                if (statusCode === 'FINISHED') {
                    isFinished = true;
                    break;
                } else if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
                    throw new Error(`Instagram container processing failed: ${statusCode} (${statusRes.data?.status || 'No additional details'})`);
                }
            } catch (pollErr: any) {
                // If it's our own thrown error, rethrow
                if (pollErr.message.includes('Instagram container processing failed')) {
                    throw pollErr;
                }
                logger.warn('[Meta Service] Container polling request warning', {
                    attempt: attempts,
                    error: pollErr.message,
                });
            }
        }

        if (!isFinished) {
            throw new Error('Instagram video processing timed out after 5 minutes');
        }

        logger.info('[Meta Service] Instagram video container processing finished', { creationId });
    }

    // Step 4: Publish container
    let mediaId: string;
    try {
        const publishRes = await axios.post(
            `${GRAPH_BASE_URL}/${igUserId}/media_publish`,
            {
                creation_id: creationId,
            },
            {
                headers: {
                    Authorization: `Bearer ${pageAccessToken}`,
                },
                timeout: 30000,
            }
        );

        mediaId = publishRes.data?.id;
        if (!mediaId) {
            throw new Error('Instagram did not return a published media ID');
        }

        logger.info('[Meta Service] Instagram media published', { mediaId });
    } catch (publishErr: any) {
        const errData = publishErr?.response?.data?.error;
        logger.error('[Meta Service] Failed publishing Instagram container', {
            error: errData || publishErr.message,
            creationId,
        });
        throw new Error(`Failed to publish Instagram media: ${errData?.message || publishErr.message}`);
    }

    // Step 5: Query permalink
    let permalink = `https://www.instagram.com/p/${mediaId}/`;
    try {
        const mediaRes = await axios.get(`${GRAPH_BASE_URL}/${mediaId}`, {
            params: {
                fields: 'permalink,id',
            },
            headers: {
                Authorization: `Bearer ${pageAccessToken}`,
            },
            timeout: 15000,
        });

        if (mediaRes.data?.permalink) {
            permalink = mediaRes.data.permalink;
        }
    } catch (permErr: any) {
        logger.warn('[Meta Service] Could not fetch media permalink, falling back to default URL', {
            mediaId,
            error: permErr.message,
        });
    }

    logger.info('[Meta Service] Instagram post completed successfully', {
        mediaId,
        permalink,
    });

    return { mediaId, permalink };
}

export { canPostTo, optimizeForInstagramImage, optimizeForInstagramVideo } from './validator.js';
