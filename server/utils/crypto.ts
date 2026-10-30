import crypto from 'crypto';

/**
 * Derives a 32-byte Buffer from the SOCIAL_TOKEN_ENC_KEY environment variable.
 * Accepts a 32-byte base64 string, 64-char hex string, or raw 32-byte utf8 string.
 */
function getEncryptionKey(): Buffer {
    const rawKey = process.env.SOCIAL_TOKEN_ENC_KEY;
    if (!rawKey) {
        throw new Error('[Crypto] FATAL: SOCIAL_TOKEN_ENC_KEY environment variable is not defined.');
    }

    // Try base64 decoding first
    const base64Buf = Buffer.from(rawKey, 'base64');
    if (base64Buf.length === 32) {
        return base64Buf;
    }

    // Try hex decoding (64 hex characters = 32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
        return Buffer.from(rawKey, 'hex');
    }

    // Fallback: UTF-8 string of 32 characters
    const utf8Buf = Buffer.from(rawKey, 'utf8');
    if (utf8Buf.length === 32) {
        return utf8Buf;
    }

    // If still not 32 bytes, derive deterministically using SHA-256
    return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypts sensitive text using AES-256-GCM with a fresh random 16-byte IV per invocation.
 * Returns formatted string: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
 */
export function encrypt(text: string): string {
    if (!text) return '';

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted payload produced by `encrypt()`.
 * Verifies authenticity via the GCM authTag.
 */
export function decrypt(payload: string): string {
    if (!payload) return '';

    const parts = payload.split(':');
    if (parts.length !== 3) {
        throw new Error('[Crypto] Invalid encrypted payload format. Expected iv:authTag:ciphertext');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}
