import axios from 'axios';
import { prisma } from '../../configs/prisma.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import logger from '../../configs/logger.js';

export interface YouTubeUploadParams {
    account: {
        id: string;
        userId: string;
        encryptedAccessToken: string;
        encryptedRefreshToken?: string | null;
        tokenExpiresAt?: Date | null;
    };
    videoUrl: string;
    title: string;
    description: string;
    privacy?: 'private' | 'unlisted' | 'public';
}

export interface YouTubeTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
}

export interface YouTubeChannelInfo {
    id: string;
    title: string;
    thumbnailUrl?: string;
}

/**
 * Ensures a valid access token for the given YouTube SocialAccount.
 * If expired or expiring within 5 minutes, automatically uses the refresh token.
 * On invalid_grant or revoked token, sets needsReconnect = true in DB.
 */
export async function getValidAccessToken(account: {
    id: string;
    encryptedAccessToken: string;
    encryptedRefreshToken?: string | null;
    tokenExpiresAt?: Date | null;
}): Promise<string> {
    const now = Date.now();
    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : 0;
    const isExpiredOrSoon = !expiresAt || expiresAt - now < 5 * 60 * 1000; // 5 min buffer

    // If still valid, return decrypted access token
    if (!isExpiredOrSoon) {
        return decrypt(account.encryptedAccessToken);
    }

    // Needs refresh
    if (!account.encryptedRefreshToken) {
        logger.warn('[YouTube Service] Missing refresh token, marking needsReconnect', {
            accountId: account.id,
        });
        await prisma.socialAccount.update({
            where: { id: account.id },
            data: { needsReconnect: true },
        });
        throw new Error('YouTube authorization expired and no refresh token available. Please reconnect your account.');
    }

    logger.info('[YouTube Service] Refreshing expired YouTube access token', {
        accountId: account.id,
    });

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('Google OAuth credentials not configured on server (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)');
    }

    const refreshToken = decrypt(account.encryptedRefreshToken);

    try {
        const response = await axios.post<YouTubeTokenResponse>(
            'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000,
            }
        );

        const { access_token, expires_in, refresh_token: newRefreshToken } = response.data;
        const newExpiresAt = new Date(Date.now() + expires_in * 1000);
        const newEncryptedAccess = encrypt(access_token);
        const updateData: any = {
            encryptedAccessToken: newEncryptedAccess,
            tokenExpiresAt: newExpiresAt,
            needsReconnect: false,
        };

        if (newRefreshToken) {
            updateData.encryptedRefreshToken = encrypt(newRefreshToken);
        }

        await prisma.socialAccount.update({
            where: { id: account.id },
            data: updateData,
        });

        logger.info('[YouTube Service] Successfully refreshed access token', {
            accountId: account.id,
            expiresAt: newExpiresAt.toISOString(),
        });

        return access_token;
    } catch (error: any) {
        const status = error?.response?.status;
        const errorData = error?.response?.data;
        const errorMsg = errorData?.error || error?.message;

        logger.error('[YouTube Service] Token refresh failed', {
            accountId: account.id,
            status,
            error: errorMsg,
        });

        if (status === 400 || status === 401 || errorData?.error === 'invalid_grant') {
            await prisma.socialAccount.update({
                where: { id: account.id },
                data: { needsReconnect: true },
            });
            throw new Error('YouTube access has been revoked or expired. Please reconnect your account.');
        }

        throw new Error(`Failed to refresh YouTube token: ${errorMsg}`);
    }
}

/**
 * Fetches the authenticated user's YouTube channel information using an access token.
 */
export async function getChannelInfo(accessToken: string): Promise<YouTubeChannelInfo> {
    try {
        const response = await axios.get(
            'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 15000,
            }
        );

        const items = response.data?.items;
        if (!items || items.length === 0) {
            throw new Error('No YouTube channel found for this Google account. Please create a channel on YouTube first.');
        }

        const channel = items[0];
        return {
            id: channel.id,
            title: channel.snippet?.title || 'YouTube Channel',
            thumbnailUrl: channel.snippet?.thumbnails?.default?.url,
        };
    } catch (error: any) {
        logger.error('[YouTube Service] Failed to fetch channel info', {
            error: error?.response?.data || error.message,
        });
        throw error;
    }
}

/**
 * Uploads a video from a Cloudinary URL to YouTube Shorts via Resumable Upload.
 * Streams the file directly from Cloudinary without buffering full video in memory.
 * Appends #Shorts to the description if not already present.
 */
export async function uploadShort(params: YouTubeUploadParams): Promise<{ videoId: string; videoUrl: string }> {
    const { account, videoUrl, title, privacy = 'private' } = params;

    logger.info('[YouTube Service] Initiating YouTube upload', {
        accountId: account.id,
        videoUrl,
        title,
        privacy,
    });

    const accessToken = await getValidAccessToken(account);

    // Format title & description
    let cleanTitle = (title || 'AI Generated UGC Video').trim();
    if (cleanTitle.length > 100) cleanTitle = cleanTitle.substring(0, 97) + '...';

    let cleanDesc = (params.description || '').trim();
    if (!cleanDesc.toLowerCase().includes('#shorts')) {
        cleanDesc = `${cleanDesc}\n\n#Shorts`.trim();
    }
    if (cleanDesc.length > 5000) cleanDesc = cleanDesc.substring(0, 5000);

    // Step 1: Query Cloudinary video metadata (Content-Length and availability) via HEAD
    let contentLength: number;
    try {
        const headRes = await axios.head(videoUrl, { timeout: 15000 });
        const lenHeader = headRes.headers['content-length'];
        if (!lenHeader) {
            throw new Error('Cloudinary response did not return Content-Length header');
        }
        contentLength = parseInt(lenHeader, 10);
    } catch (headErr: any) {
        logger.error('[YouTube Service] Failed to read video headers from Cloudinary', {
            videoUrl,
            error: headErr.message,
        });
        throw new Error(`Unable to fetch video from storage: ${headErr.message}`);
    }

    // Step 2: Initiate Resumable Upload Session with YouTube API
    let uploadLocation: string;
    try {
        const initRes = await axios.post(
            'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
            {
                snippet: {
                    title: cleanTitle,
                    description: cleanDesc,
                    categoryId: '22', // People & Blogs (standard for UGC / social)
                },
                status: {
                    privacyStatus: privacy,
                    selfDeclaredMadeForKids: false,
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Type': 'video/mp4',
                    'X-Upload-Content-Length': contentLength.toString(),
                },
                timeout: 30000,
            }
        );

        uploadLocation = initRes.headers['location'];
        if (!uploadLocation) {
            throw new Error('YouTube did not provide a resumable upload location URL');
        }
    } catch (initErr: any) {
        logger.error('[YouTube Service] Failed to create resumable upload session', {
            error: initErr?.response?.data || initErr.message,
        });
        throw new Error(`Failed to initiate YouTube upload session: ${initErr?.response?.data?.error?.message || initErr.message}`);
    }

    // Step 3: Stream video from Cloudinary directly to YouTube resumable URL
    logger.info('[YouTube Service] Streaming video from Cloudinary to YouTube', {
        contentLength,
        uploadLocation: uploadLocation.split('?')[0],
    });

    try {
        const mediaStream = await axios.get(videoUrl, {
            responseType: 'stream',
            timeout: 60000,
        });

        const uploadRes = await axios.put(uploadLocation, mediaStream.data, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': contentLength.toString(),
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 300000, // 5 minutes max upload
        });

        const videoId = uploadRes.data?.id;
        if (!videoId) {
            throw new Error('YouTube upload completed but no video ID was returned');
        }

        const shortsUrl = `https://youtube.com/shorts/${videoId}`;
        logger.info('[YouTube Service] Video uploaded successfully to YouTube', {
            videoId,
            shortsUrl,
        });

        return {
            videoId,
            videoUrl: shortsUrl,
        };
    } catch (streamErr: any) {
        logger.error('[YouTube Service] Failed streaming video to YouTube', {
            error: streamErr?.response?.data || streamErr.message,
        });
        throw new Error(`Failed during YouTube video stream upload: ${streamErr?.response?.data?.error?.message || streamErr.message}`);
    }
}
