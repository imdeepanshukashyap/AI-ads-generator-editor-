import { GoogleGenAI } from '@google/genai';
import logger from './logger.js';

// ─── API Key Registry ────────────────────────────────────────────────────────
// Keys are indexed 0-based; displayed as KEY1 / KEY2 in logs (1-indexed).
const API_KEYS: string[] = [
    process.env.GOOGLE_CLOUD_API_KEY1 || '',
    process.env.GOOGLE_CLOUD_API_KEY2 || '',
].filter(Boolean);

if (API_KEYS.length === 0) {
    throw new Error(
        '[AI Config] FATAL: No Google Cloud API keys found in environment ' +
        '(GOOGLE_CLOUD_API_KEY1, GOOGLE_CLOUD_API_KEY2)'
    );
}

logger.info('[AI Config] Loaded Google Cloud API keys', {
    keyCount: API_KEYS.length,
    keys: API_KEYS.map((_, i) => `KEY${i + 1}`),
});

// ─── Client Builder ──────────────────────────────────────────────────────────
/** Create a fresh GoogleGenAI client for the given key index */
const buildClient = (index: number): GoogleGenAI =>
    new GoogleGenAI({ apiKey: API_KEYS[index] });

// ─── Error Classification ─────────────────────────────────────────────────────
/**
 * Returns true when the error signals that the current API key is exhausted /
 * invalid and we should try the next key.
 *
 * Covered cases:
 *  - HTTP 429  "quota exceeded" / "resource exhausted"
 *  - HTTP 403  "billing" / "credit" / "payment required"
 *  - HTTP 401  "api key not valid" / "api_key_invalid"
 *  - Any message containing quota/rate-limit/billing/exhausted keywords
 */
export const isKeyExhaustedError = (err: any): boolean => {
    const msg: string = (err?.message || err?.toString() || '').toLowerCase();
    const status: number | undefined = err?.status || err?.response?.status;

    const exhaustedKeywords = [
        'quota',
        'rate limit',
        'rate_limit',
        'resource_exhausted',
        'resource exhausted',
        'billing',
        'credit',
        'payment required',
        'api key not valid',
        'api_key_invalid',
        'apikey',
        'key expired',
        'insufficient',
        'invalid_argument',   // Google returns 400 INVALID_ARGUMENT for bad keys
    ];

    const isKeyword = exhaustedKeywords.some(kw => msg.includes(kw));
    // Google returns 400 for API_KEY_INVALID (not 401/403 as one might expect)
    const isStatusCode = status === 400 || status === 429 || status === 403 || status === 401;

    return isKeyword || isStatusCode;
};

// ─── Key Rotation ─────────────────────────────────────────────────────────────
/**
 * Attempts all API keys in order for a given async call.
 *
 * Strategy: per-request round-robin — always starts from KEY1 on each new
 * request so a key that recovers (quota reset, reactivated) is retried
 * naturally on the next call.
 *
 * @param callerContext  Human-readable name for logs (e.g. "models.generateContent")
 * @param fn             Factory that receives a GoogleGenAI client and returns a Promise
 */
export const withKeyFallback = async <T>(
    callerContext: string,
    fn: (client: GoogleGenAI) => Promise<T>
): Promise<T> => {
    const attemptedKeys: string[] = [];

    for (let i = 0; i < API_KEYS.length; i++) {
        const keyLabel = `KEY${i + 1}`;
        attemptedKeys.push(keyLabel);
        const client = buildClient(i);

        logger.debug(`[AI Config] ${callerContext} — attempting with ${keyLabel}`);

        try {
            const result = await fn(client);
            logger.info(`[AI Config] ${callerContext} — succeeded with ${keyLabel}`, {
                attemptedKeys,
            });
            return result;
        } catch (err: any) {
            const status = err?.status || err?.response?.status;
            const isExhausted = isKeyExhaustedError(err);

            logger.error(`[AI Config] ${callerContext} — FAILED with ${keyLabel}`, {
                errorType: isExhausted ? 'KEY_EXHAUSTED' : 'API_ERROR',
                errorMessage: err?.message,
                errorStatus: status,
                attemptedKeys,
                willRetry: isExhausted && i + 1 < API_KEYS.length,
                stack: err?.stack,
            });

            if (!isExhausted) {
                // Not a key problem (content filter, model error, network …) — fail fast
                throw err;
            }

            if (i + 1 >= API_KEYS.length) {
                // All keys exhausted
                logger.error(
                    `[AI Config] ${callerContext} — ALL ${API_KEYS.length} key(s) exhausted`,
                    { attemptedKeys, lastError: err?.message }
                );
                throw new Error(
                    `[AI] All ${API_KEYS.length} API key(s) exhausted/invalid. ` +
                    `Last error (${keyLabel}): ${err.message}`
                );
            }

            // Rotate to next key and continue loop
            logger.warn(`[AI Config] ${callerContext} — rotating KEY${i + 1} → KEY${i + 2}`, {
                reason: err?.message,
                errorStatus: status,
            });
        }
    }

    // TypeScript: unreachable, but satisfies the return type
    throw new Error(`[AI Config] ${callerContext} — unexpected: no keys available`);
};

// ─── Fallback-Aware Wrappers ──────────────────────────────────────────────────

/**
 * Wraps `ai.models.generateContent` — tries KEY1 first, falls back to KEY2+
 * on any key-exhausted / invalid-key error. Fresh from KEY1 on every call.
 */
export const generateContentWithFallback = (
    params: Parameters<GoogleGenAI['models']['generateContent']>[0],
    callerContext: string = 'models.generateContent'
): Promise<ReturnType<GoogleGenAI['models']['generateContent']>> =>
    withKeyFallback(callerContext, client => client.models.generateContent(params) as any);

/**
 * Wraps `ai.models.generateVideos` — same per-request fallback strategy.
 */
export const generateVideosWithFallback = (
    params: Parameters<GoogleGenAI['models']['generateVideos']>[0],
    callerContext: string = 'models.generateVideos'
): Promise<ReturnType<GoogleGenAI['models']['generateVideos']>> =>
    withKeyFallback(callerContext, client => client.models.generateVideos(params) as any);


/**
 * Wraps `ai.operations.getVideosOperation` — polls operation status.
 * Uses KEY1 by default (operation was already started with a given key).
 */
export const getVideosOperationWithFallback = async (
    params: Parameters<GoogleGenAI['operations']['getVideosOperation']>[0],
    callerContext: string = 'operations.getVideosOperation'
): Promise<ReturnType<GoogleGenAI['operations']['getVideosOperation']>> => {
    logger.debug(`[AI Config] ${callerContext} — polling`);
    try {
        const result = await buildClient(0).operations.getVideosOperation(params);
        return result as any;
    } catch (err: any) {
        logger.error(`[AI Config] ${callerContext} — polling FAILED`, {
            errorMessage: err?.message,
            errorStatus: err?.status || err?.response?.status,
            stack: err?.stack,
        });
        throw err;
    }
};

/**
 * Wraps `ai.files.download` with structured error logging.
 */
export const downloadFileWithFallback = async (
    params: Parameters<GoogleGenAI['files']['download']>[0],
    callerContext: string = 'files.download'
): Promise<ReturnType<GoogleGenAI['files']['download']>> => {
    logger.debug(`[AI Config] ${callerContext} — downloading`);
    try {
        const result = await buildClient(0).files.download(params);
        return result as any;
    } catch (err: any) {
        logger.error(`[AI Config] ${callerContext} — download FAILED`, {
            errorMessage: err?.message,
            errorStatus: err?.status || err?.response?.status,
            stack: err?.stack,
        });
        throw err;
    }
};

// ─── Drop-in Replacement Export ───────────────────────────────────────────────
/**
 * Backwards-compatible `ai` object that mirrors the GoogleGenAI interface but
 * routes every call through the fallback-aware wrappers above.
 *
 * No changes are required in projectController.ts — `import ai from './ai.js'`
 * continues to work exactly as before.
 */
const aiWithFallback = {
    get models() {
        return {
            generateContent: (params: any) =>
                generateContentWithFallback(params, 'models.generateContent'),
            generateVideos: (params: any) =>
                generateVideosWithFallback(params, 'models.generateVideos'),
        };
    },
    get operations() {
        return {
            getVideosOperation: (params: any) =>
                getVideosOperationWithFallback(params, 'operations.getVideosOperation'),
        };
    },
    get files() {
        return {
            download: (params: any) =>
                downloadFileWithFallback(params, 'files.download'),
        };
    },
};

export default aiWithFallback;