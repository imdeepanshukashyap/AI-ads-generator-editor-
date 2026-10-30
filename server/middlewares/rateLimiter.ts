import rateLimit from 'express-rate-limit';

/**
 * Standard rate limiter for general social account operations
 * 60 requests per minute
 */
export const socialGeneralLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many requests to social media endpoints. Please try again in a minute.',
    },
});

/**
 * Rate limiter for AI caption generation to prevent Gemini quota exhaustion
 * 10 requests per minute
 */
export const socialCaptionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many AI caption generation requests. Please slow down and try again shortly.',
    },
});

/**
 * Rate limiter for social publishing and retries to prevent spamming platform APIs
 * 20 posts or retries per 15 minutes
 */
export const socialPublishLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Post creation limit reached. Please wait a few minutes before publishing again.',
    },
});

/**
 * Rate limiter for OAuth initialization to protect against state signing exhaustion
 * 15 OAuth initializations per 15 minutes
 */
export const socialAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many social connection attempts. Please wait a few minutes and try again.',
    },
});
