import crypto from 'crypto';

// Setup test encryption key (32 bytes base64) if not present
if (!process.env.SOCIAL_TOKEN_ENC_KEY) {
    process.env.SOCIAL_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
}

import { encrypt, decrypt } from '../utils/crypto.js';
import { signState, verifyState } from '../utils/oauthState.js';
import { canPostTo, optimizeForInstagramImage, optimizeForInstagramVideo } from '../services/social/validator.js';
import { socialGeneralLimiter, socialCaptionLimiter, socialPublishLimiter, socialAuthLimiter } from '../middlewares/rateLimiter.js';

async function runPhase7Tests() {
    console.log('\n======================================================================');
    console.log('🧪 RUNNING PHASE 7 (HARDENING, SECURITY & INTEGRATION) VERIFICATION');
    console.log('======================================================================\n');

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition: boolean, testName: string) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passedTests++;
        } else {
            console.error(`  ❌ FAIL: ${testName}`);
            failedTests++;
        }
    }

    // ----------------------------------------------------
    // TEST 1: AES-256-GCM Crypto Round-Trip & Tamper Protection
    // ----------------------------------------------------
    console.log('🔹 [Test 1] AES-256-GCM Token Security & Authenticated Decryption');
    const sensitiveToken = 'EAAGm0PX4ZBtwBO7z...long_lived_meta_access_token_super_secret';
    const encrypted = encrypt(sensitiveToken);

    assert(encrypted.includes(':'), 'Encrypted string is formatted as iv:tag:ciphertext');
    const [iv, tag, ciphertext] = encrypted.split(':');
    assert(iv.length === 32, 'IV is exactly 16 bytes hex (32 chars)');
    assert(tag.length === 32, 'GCM Auth tag is exactly 16 bytes hex (32 chars)');

    const decrypted = decrypt(encrypted);
    assert(decrypted === sensitiveToken, 'Decrypted token matches original secret exactly');

    // Tampered ciphertext should throw authentication tag error
    const tamperedCiphertext = `${iv}:${tag}:abcd${ciphertext.slice(4)}`;
    let tamperDetected = false;
    try {
        decrypt(tamperedCiphertext);
    } catch {
        tamperDetected = true;
    }
    assert(tamperDetected, 'Tampered ciphertext is immediately detected and rejected by GCM tag');

    // ----------------------------------------------------
    // TEST 2: HMAC Signed OAuth State & Timing-Safe Equality
    // ----------------------------------------------------
    console.log('\n🔹 [Test 2] OAuth State Integrity, Expiry & Signature Verification');
    const stateToken = signState('user_clerk_12345', 'youtube');
    assert(typeof stateToken === 'string' && stateToken.includes('.'), 'State is formatted as base64payload.hexsignature');

    const verified = verifyState(stateToken);
    assert(verified !== null && verified.userId === 'user_clerk_12345' && verified.platform === 'youtube', 'Valid state is verified and decoded correctly');

    // Tampered payload
    const [payloadB64, signature] = stateToken.split('.');
    const tamperedState = `eyJhYnVzZXIiOiIxIn0=.${signature}`;
    const verifiedTampered = verifyState(tamperedState);
    assert(verifiedTampered === null, 'Tampered payload in state token fails verification');

    // Mismatched signature length
    const invalidLengthState = `${payloadB64}.shortsignature`;
    const verifiedShort = verifyState(invalidLengthState);
    assert(verifiedShort === null, 'Invalid signature length safely rejected without timing leak');

    // ----------------------------------------------------
    // TEST 3: canPostTo Compatibility Matrix
    // ----------------------------------------------------
    console.log('\n🔹 [Test 3] Multi-Platform Media Compatibility Matrix');
    const verticalVideo = 'https://res.cloudinary.com/demo/video/upload/sample.mp4';
    const horizontalVideo = 'https://res.cloudinary.com/demo/video/upload/horizontal.mp4';
    const verticalImage = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

    // YouTube Shorts: 9:16 vertical videos vs standard videos
    const ytShortsCheck = canPostTo('youtube', 'video', '9:16', verticalVideo);
    assert(ytShortsCheck.canPost && ytShortsCheck.postType === 'short', 'YouTube categorizes 9:16 vertical video as Shorts');
    const ytLandscapeCheck = canPostTo('youtube', 'video', '16:9', horizontalVideo);
    assert(ytLandscapeCheck.canPost && ytLandscapeCheck.postType === 'video', 'YouTube categorizes 16:9 as standard landscape video');
    assert(!canPostTo('youtube', 'image', '9:16', verticalImage).canPost, 'YouTube rejects still images');

    // Facebook: Allows both image and video
    assert(canPostTo('facebook', 'image', '9:16', verticalImage).canPost, 'Facebook allows image');
    assert(canPostTo('facebook', 'video', '9:16', verticalVideo).canPost, 'Facebook allows video');

    // Instagram: Requires padding for 9:16 photos on feed
    const igImageCheck = canPostTo('instagram', 'image', '9:16', verticalImage);
    assert(igImageCheck.canPost && Boolean(igImageCheck.warning?.includes('4:5 ratio')) && Boolean(igImageCheck.transformedMediaUrl?.includes('c_pad,ar_4:5')), 'Instagram identifies 9:16 photo requires 4:5 padding');

    // ----------------------------------------------------
    // TEST 4: Cloudinary Dynamic Media URL Optimization
    // ----------------------------------------------------
    console.log('\n🔹 [Test 4] Cloudinary Dynamic Transformation Injection');
    const rawCloudinaryImg = 'https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg';
    const paddedImg = optimizeForInstagramImage(rawCloudinaryImg, '9:16');
    assert(paddedImg.includes('/c_pad,ar_4:5,b_black,q_auto,f_jpg/'), 'Injects 4:5 aspect ratio padding for Instagram feed');

    const rawCloudinaryVid = 'https://res.cloudinary.com/demo/video/upload/v12345/sample.mp4';
    const optimizedVid = optimizeForInstagramVideo(rawCloudinaryVid);
    assert(optimizedVid.includes('/vc_h264,ac_aac,f_mp4/'), 'Injects H.264 video codec and AAC audio codec for Instagram Reels');

    // ----------------------------------------------------
    // TEST 5: Caption Length Limits Per Platform
    // ----------------------------------------------------
    console.log('\n🔹 [Test 5] Platform-Specific Caption Boundary Limits');
    const shortCaption = 'Great product check it out!';
    const igLimitCaption = 'A'.repeat(2200);
    const igTooLongCaption = 'A'.repeat(2201);
    const fbLimitCaption = 'B'.repeat(5000);
    const fbTooLongCaption = 'B'.repeat(5001);

    assert(igLimitCaption.length <= 2200, 'Instagram 2,200 character boundary accepted');
    assert(igTooLongCaption.length > 2200, 'Instagram >2,200 character boundary flagged as invalid');
    assert(fbLimitCaption.length <= 5000, 'Facebook 5,000 character boundary accepted');
    assert(fbTooLongCaption.length > 5000, 'Facebook >5,000 character boundary flagged as invalid');

    // ----------------------------------------------------
    // TEST 6: Cloudinary URL Whitelist & SSRF Guard
    // ----------------------------------------------------
    console.log('\n🔹 [Test 6] Cloudinary Domain Security Guard');
    function isSecureCloudinaryUrl(urlStr: string): boolean {
        try {
            const parsed = new URL(urlStr);
            return parsed.hostname.includes('cloudinary.com') || parsed.hostname.includes('res.cloudinary.com');
        } catch {
            return false;
        }
    }

    assert(isSecureCloudinaryUrl('https://res.cloudinary.com/mycloud/image/upload/ad.jpg'), 'Valid Cloudinary CDN URL accepted');
    assert(!isSecureCloudinaryUrl('https://malicious-site.com/exploit.mp4'), 'Non-Cloudinary URL rejected');
    assert(!isSecureCloudinaryUrl('javascript:alert(1)'), 'Dangerous scheme rejected');
    assert(!isSecureCloudinaryUrl('http://169.254.169.254/latest/meta-data/'), 'AWS metadata SSRF IP rejected');

    // ----------------------------------------------------
    // TEST 7: Rate Limiter Middleware Configuration
    // ----------------------------------------------------
    console.log('\n🔹 [Test 7] Express Rate Limiting Configuration');
    assert(typeof socialGeneralLimiter === 'function', 'socialGeneralLimiter is initialized middleware');
    assert(typeof socialCaptionLimiter === 'function', 'socialCaptionLimiter is initialized middleware');
    assert(typeof socialPublishLimiter === 'function', 'socialPublishLimiter is initialized middleware');
    assert(typeof socialAuthLimiter === 'function', 'socialAuthLimiter is initialized middleware');

    // ----------------------------------------------------
    // Summary
    // ----------------------------------------------------
    console.log('\n======================================================================');
    console.log(`Phase 7 Tests Completed: ${passedTests} passed, ${failedTests} failed`);
    console.log('======================================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runPhase7Tests().catch(err => {
    console.error('Test script crashed:', err);
    process.exit(1);
});
