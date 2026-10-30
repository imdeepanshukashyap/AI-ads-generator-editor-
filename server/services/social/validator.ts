export type Platform = 'instagram' | 'facebook' | 'youtube';
export type MediaType = 'image' | 'video';
export type AspectRatio = '9:16' | '16:9' | string;

export interface ValidationResult {
    canPost: boolean;
    postType?: 'photo' | 'video' | 'reel' | 'short';
    reason?: string;
    warning?: string;
    transformedMediaUrl?: string;
}

/**
 * Transforms Cloudinary URLs for Instagram Feed Image compatibility.
 * Instagram Feed strictly requires aspect ratios between 4:5 (0.80) and 1.91:1.
 * 9:16 (0.5625) images are padded to 4:5 with black background to prevent rejection.
 */
export function optimizeForInstagramImage(url: string, aspectRatio?: string): string {
    if (!url || !url.includes('cloudinary.com')) return url;

    // If 9:16 vertical still image, apply pad transformation to 4:5
    if (aspectRatio === '9:16' && !url.includes('c_pad')) {
        return url.replace('/upload/', '/upload/c_pad,ar_4:5,b_black,q_auto,f_jpg/');
    }

    // Default image optimization
    if (!url.includes('q_auto')) {
        return url.replace('/upload/', '/upload/q_auto,f_jpg/');
    }

    return url;
}

/**
 * Transforms Cloudinary video URLs for Instagram Reels / Video compatibility.
 * Ensures H.264 video codec, AAC audio codec, and MP4 container.
 */
export function optimizeForInstagramVideo(url: string): string {
    if (!url || !url.includes('cloudinary.com')) return url;

    if (!url.includes('vc_h264')) {
        return url.replace('/upload/', '/upload/vc_h264,ac_aac,f_mp4/');
    }

    return url;
}

/**
 * Validates whether a given mediaType and aspectRatio can be posted to the target platform
 * based on current official API specifications (Meta Graph API & YouTube Data API v3).
 */
export function canPostTo(platform: Platform, mediaType: MediaType, aspectRatio: AspectRatio = '9:16', mediaUrl?: string): ValidationResult {
    // ----------------------------------------------------
    // YOUTUBE RULES
    // ----------------------------------------------------
    if (platform === 'youtube') {
        if (mediaType === 'image') {
            return {
                canPost: false,
                reason: 'YouTube does not support image posts via API (videos only).',
            };
        }

        if (aspectRatio === '9:16') {
            return {
                canPost: true,
                postType: 'short',
                warning: 'Will be published as a vertical YouTube Short with #Shorts.',
                transformedMediaUrl: mediaUrl,
            };
        }

        return {
            canPost: true,
            postType: 'video',
            warning: 'Will be published as a standard YouTube video (16:9 landscape format).',
            transformedMediaUrl: mediaUrl,
        };
    }

    // ----------------------------------------------------
    // FACEBOOK RULES
    // ----------------------------------------------------
    if (platform === 'facebook') {
        if (mediaType === 'image') {
            return {
                canPost: true,
                postType: 'photo',
                transformedMediaUrl: mediaUrl,
            };
        }

        return {
            canPost: true,
            postType: 'video',
            transformedMediaUrl: mediaUrl,
        };
    }

    // ----------------------------------------------------
    // INSTAGRAM RULES
    // ----------------------------------------------------
    if (platform === 'instagram') {
        if (mediaType === 'video') {
            const transformed = mediaUrl ? optimizeForInstagramVideo(mediaUrl) : undefined;
            return {
                canPost: true,
                postType: 'reel',
                warning: 'Will be published as an Instagram Reel.',
                transformedMediaUrl: transformed,
            };
        }

        // Image posting to Instagram Feed
        if (aspectRatio === '9:16') {
            const transformed = mediaUrl ? optimizeForInstagramImage(mediaUrl, '9:16') : undefined;
            return {
                canPost: true,
                postType: 'photo',
                warning: 'Instagram Feed does not support 9:16 still photos. Media will be automatically padded to 4:5 ratio.',
                transformedMediaUrl: transformed,
            };
        }

        // 16:9 (1.77:1) is within Instagram 4:5 (0.8) to 1.91:1 bounds
        const transformed = mediaUrl ? optimizeForInstagramImage(mediaUrl, aspectRatio) : undefined;
        return {
            canPost: true,
            postType: 'photo',
            transformedMediaUrl: transformed,
        };
    }

    return {
        canPost: false,
        reason: `Unsupported platform: ${platform}`,
    };
}
