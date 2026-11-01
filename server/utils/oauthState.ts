import crypto from 'crypto';

export type SocialPlatform = 'instagram' | 'facebook' | 'youtube';

interface StatePayload {
    userId: string;
    platform: SocialPlatform;
    exp: number; // Unix timestamp in ms (10 min TTL)
    nonce: string;
}

function getSigningSecret(): string {
    const secret = process.env.SOCIAL_TOKEN_ENC_KEY || process.env.CLERK_SECRET_KEY || 'default-fallback-oauth-secret-key-32b';
    return secret;
}

/**
 * Signs an OAuth state token carrying the Clerk userId and target platform.
 * Token expires automatically after 10 minutes.
 */
export function signState(userId: string, platform: SocialPlatform): string {
    if (!userId || !platform) {
        throw new Error('[OAuthState] userId and platform are required to sign OAuth state');
    }

    const payload: StatePayload = {
        userId,
        platform,
        exp: Date.now() + 10 * 60 * 1000, // 10 minutes
        nonce: crypto.randomBytes(8).toString('hex'),
    };

    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64url');

    const signature = crypto
        .createHmac('sha256', getSigningSecret())
        .update(payloadB64)
        .digest('base64url');

    return `${payloadB64}.${signature}`;
}

/**
 * Verifies and decodes an OAuth state token.
 * Validates HMAC signature and checks that token has not expired.
 * Returns decoded { userId, platform } or null if invalid/expired.
 */
export function verifyState(state: string): { userId: string; platform: SocialPlatform } | null {
    if (!state || typeof state !== 'string') return null;

    const parts = state.split('.');
    if (parts.length !== 2) return null;

    const [payloadB64, signature] = parts;

    // Recalculate HMAC signature
    const expectedSig = crypto
        .createHmac('sha256', getSigningSecret())
        .update(payloadB64)
        .digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedSigBuf = Buffer.from(expectedSig, 'utf8');

    // Constant-time comparison (guards against length mismatch throwing RangeError)
    if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
        return null;
    }

    try {
        const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
        const payload: StatePayload = JSON.parse(payloadStr);

        // Check expiration
        if (!payload.exp || Date.now() > payload.exp) {
            return null;
        }

        if (!payload.userId || !payload.platform) {
            return null;
        }

        return {
            userId: payload.userId,
            platform: payload.platform,
        };
    } catch {
        return null;
    }
}
