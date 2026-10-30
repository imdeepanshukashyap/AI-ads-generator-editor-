import api from '../configs/axios';
import type { SocialAccount, ScheduledPost } from '../types';

/**
 * Fetch all connected social accounts for the user
 */
export async function fetchConnectedAccounts(token: string): Promise<SocialAccount[]> {
    const { data } = await api.get('/api/social/accounts', {
        headers: { Authorization: `Bearer ${token}` },
    });
    return data.accounts || [];
}

/**
 * Disconnect a social account
 */
export async function disconnectSocialAccount(id: string, token: string): Promise<void> {
    await api.delete(`/api/social/accounts/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}

/**
 * Retrieve OAuth authorization URL for YouTube or Meta
 */
export async function getConnectAuthUrl(platform: 'youtube' | 'meta', token: string): Promise<string> {
    const endpoint = platform === 'youtube' ? '/api/social/connect/youtube' : '/api/social/connect/meta';
    const { data } = await api.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return data.authUrl;
}

/**
 * Generate AI-tailored caption & hashtags using Gemini
 */
export async function generateAiCaption(
    projectId: string,
    platform: string,
    token: string,
    tone: string = 'engaging and authentic'
): Promise<{ caption: string; hashtags: string[] }> {
    const { data } = await api.post(
        '/api/social/caption',
        { projectId, platform, tone },
        { headers: { Authorization: `Bearer ${token}` } }
    );
    return data;
}

/**
 * Publish now or schedule a post
 */
export async function publishSocialPost(
    params: {
        projectId: string;
        socialAccountId: string;
        mediaUrl: string;
        caption: string;
        aiDisclosure: boolean;
        scheduledFor?: string;
    },
    token: string
): Promise<{ post: ScheduledPost; message: string }> {
    const { data } = await api.post('/api/social/post', params, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return data;
}

/**
 * Fetch user's social post history
 */
export async function fetchPostHistory(token: string): Promise<ScheduledPost[]> {
    const { data } = await api.get('/api/social/posts', {
        headers: { Authorization: `Bearer ${token}` },
    });
    return data.posts || [];
}

/**
 * Retry a failed social post
 */
export async function retrySocialPost(postId: string, token: string): Promise<any> {
    const { data } = await api.post(`/api/social/posts/${postId}/retry`, {}, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return data;
}
