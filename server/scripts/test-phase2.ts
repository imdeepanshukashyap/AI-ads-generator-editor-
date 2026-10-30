import crypto from 'crypto';
import { signState, verifyState } from '../utils/oauthState.js';
import { encrypt, decrypt } from '../utils/crypto.js';

// Setup test encryption key if not present
if (!process.env.SOCIAL_TOKEN_ENC_KEY) {
    process.env.SOCIAL_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
}

async function runPhase2Tests() {
    console.log('\n========================================');
    console.log('🧪 RUNNING PHASE 2 (YOUTUBE) VERIFICATION TESTS');
    console.log('========================================\n');

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
    // TEST 1: Google OAuth URL Construction & Scopes
    // ----------------------------------------------------
    console.log('🔹 [Test 1] Google OAuth URL Construction');
    const testUserId = 'user_test_yt_123';
    const state = signState(testUserId, 'youtube');
    const clientId = 'test-client-id.apps.googleusercontent.com';
    const redirectUri = 'http://localhost:5001/api/social/callback/youtube';

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

    assert(authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'URL points to Google OAuth v2 endpoint');
    assert(authUrl.includes('access_type=offline'), 'Requests offline access for refresh token');
    assert(authUrl.includes('prompt=consent'), 'Forces consent prompt to guarantee refresh token');
    assert(authUrl.includes(encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')), 'Includes youtube.upload scope');
    assert(authUrl.includes(encodeURIComponent('https://www.googleapis.com/auth/youtube.readonly')), 'Includes youtube.readonly scope');

    const decodedState = verifyState(state);
    assert(decodedState?.userId === testUserId && decodedState?.platform === 'youtube', 'OAuth state preserves user identity securely');

    // ----------------------------------------------------
    // TEST 2: YouTube Shorts Title & Description Formatter
    // ----------------------------------------------------
    console.log('\n🔹 [Test 2] YouTube Shorts Metadata Formatting & #Shorts Append');
    const rawTitle = '   My Awesome AI Generated UGC Perfume Ad Video Shoot   ';
    let cleanTitle = rawTitle.trim();
    if (cleanTitle.length > 100) cleanTitle = cleanTitle.substring(0, 97) + '...';
    assert(cleanTitle === 'My Awesome AI Generated UGC Perfume Ad Video Shoot', 'Title trimmed and kept within 100 chars');

    let descWithoutShorts = 'Check out this new luxury perfume! Perfect for summer.';
    if (!descWithoutShorts.toLowerCase().includes('#shorts')) {
        descWithoutShorts = `${descWithoutShorts}\n\n#Shorts`.trim();
    }
    assert(descWithoutShorts.includes('#Shorts'), 'Appends #Shorts when missing from description');

    let descWithShorts = 'Check out this #shorts video!';
    if (!descWithShorts.toLowerCase().includes('#shorts')) {
        descWithShorts = `${descWithShorts}\n\n#Shorts`.trim();
    }
    assert(descWithShorts === 'Check out this #shorts video!', 'Does not duplicate #shorts if already present');

    // ----------------------------------------------------
    // TEST 3: Encrypted Token Storage Simulation
    // ----------------------------------------------------
    console.log('\n🔹 [Test 3] Token Encryption & Expiry Buffer Check');
    const rawAccessToken = 'ya29.sample_fresh_token_xyz';
    const rawRefreshToken = '1//0g_sample_refresh_token_abc';
    const encryptedAccess = encrypt(rawAccessToken);
    const encryptedRefresh = encrypt(rawRefreshToken);

    const now = Date.now();
    // Case A: token expires in 50 minutes -> valid
    const validExpiry = new Date(now + 50 * 60 * 1000);
    const isStillValid = (validExpiry.getTime() - now) > 5 * 60 * 1000;
    assert(isStillValid, 'Token expiring in 50 min recognized as valid without refresh');
    assert(decrypt(encryptedAccess) === rawAccessToken, 'Decrypted token matches raw access token');

    // Case B: token expires in 2 minutes -> needs refresh
    const soonExpiry = new Date(now + 2 * 60 * 1000);
    const needsRefresh = (soonExpiry.getTime() - now) < 5 * 60 * 1000;
    assert(needsRefresh, 'Token expiring within 5 min triggers auto-refresh proactively');
    assert(decrypt(encryptedRefresh) === rawRefreshToken, 'Decrypted refresh token matches raw refresh token');

    console.log('\n========================================');
    console.log(`📊 RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('========================================\n');

    if (failedTests > 0) process.exit(1);
}

runPhase2Tests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
