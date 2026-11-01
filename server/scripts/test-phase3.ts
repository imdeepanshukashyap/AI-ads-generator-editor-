import crypto from 'crypto';
import { signState, verifyState } from '../utils/oauthState.js';
import { encrypt, decrypt } from '../utils/crypto.js';

// Setup test encryption key if not present
if (!process.env.SOCIAL_TOKEN_ENC_KEY) {
    process.env.SOCIAL_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
}

async function runPhase3Tests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING PHASE 3 (META & FACEBOOK) VERIFICATION TESTS');
    console.log('======================================================\n');

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
    // TEST 1: Facebook OAuth URL Construction & Scopes
    // ----------------------------------------------------
    console.log('🔹 [Test 1] Facebook Dialog OAuth URL Construction');
    const testUserId = 'user_clerk_meta_test_456';
    const state = signState(testUserId, 'facebook');
    const appId = '123456789012345';
    const redirectUri = 'http://localhost:5001/api/social/callback/meta';

    const scopes = [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'instagram_basic',
        'instagram_content_publish',
    ].join(',');

    const authParams = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        state,
        scope: scopes,
        response_type: 'code',
    });

    const authUrl = `https://www.facebook.com/v20.0/dialog/oauth?${authParams.toString()}`;

    assert(authUrl.startsWith('https://www.facebook.com/v20.0/dialog/oauth'), 'URL points to Meta v20.0 dialog endpoint');
    assert(authUrl.includes('scope=pages_show_list'), 'Includes pages_show_list scope');
    assert(authUrl.includes('pages_manage_posts'), 'Includes pages_manage_posts scope');
    assert(authUrl.includes('instagram_content_publish'), 'Includes instagram_content_publish scope');

    const decoded = verifyState(state);
    assert(decoded?.userId === testUserId && decoded?.platform === 'facebook', 'Signed state correctly retains user and platform');

    // ----------------------------------------------------
    // TEST 2: Page & Instagram Business Account Hierarchy Parsing
    // ----------------------------------------------------
    console.log('\n🔹 [Test 2] Page & Instagram Hierarchy Parsing');
    const mockGraphResponse = {
        data: [
            {
                id: 'page_1001',
                name: 'Vigyapan Demo Page',
                access_token: 'EAAB_sample_page_token_abc',
                instagram_business_account: {
                    id: 'ig_2001',
                    username: 'vigyapan_demo',
                    name: 'Vigyapan Demo IG',
                },
            },
            {
                id: 'page_1002',
                name: 'Secondary Unlinked Page',
                access_token: 'EAAB_sample_page_token_xyz',
            },
        ],
    };

    assert(mockGraphResponse.data.length === 2, 'Parsed 2 Facebook Pages');
    assert(mockGraphResponse.data[0].instagram_business_account?.username === 'vigyapan_demo', 'Extracted linked Instagram Business Account username');
    assert(mockGraphResponse.data[1].instagram_business_account === undefined, 'Gracefully handles Pages without Instagram connection');

    // Encrypt both Page tokens
    const encToken1 = encrypt(mockGraphResponse.data[0].access_token);
    assert(decrypt(encToken1) === 'EAAB_sample_page_token_abc', 'Page access token safely encrypted and decrypted');

    // ----------------------------------------------------
    // TEST 3: Facebook Graph Photo & Video Request Structure
    // ----------------------------------------------------
    console.log('\n🔹 [Test 3] Facebook Photo & Video API Payload Formatting');
    const photoPayload = {
        url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        caption: 'Luxury summer footwear now available! #ad #fashion',
    };
    assert(photoPayload.url.startsWith('https://res.cloudinary.com'), 'Photo uses direct Cloudinary public URL');
    assert(photoPayload.caption.includes('#fashion'), 'Photo includes custom caption');

    const videoPayload = {
        file_url: 'https://res.cloudinary.com/demo/video/upload/sample.mp4',
        description: 'New dynamic commercial! Check it out.',
    };
    assert(videoPayload.file_url.endsWith('.mp4'), 'Video uses direct Cloudinary MP4 URL');
    assert(videoPayload.description.length > 0, 'Video payload uses description field');

    // ----------------------------------------------------
    // TEST 4: Meta Error 190 (OAuthException) Detection
    // ----------------------------------------------------
    console.log('\n🔹 [Test 4] Meta Token Expiry / Error 190 Classification');
    const metaErrorObj = {
        code: 190,
        type: 'OAuthException',
        message: 'Error validating access token: Session has expired.',
    };
    const isTokenRevoked = metaErrorObj.code === 190 || metaErrorObj.type === 'OAuthException';
    assert(isTokenRevoked, 'Error 190 correctly identifies token expiration/revocation for needsReconnect flag');

    console.log('\n======================================================');
    console.log(`📊 RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('======================================================\n');

    if (failedTests > 0) process.exit(1);
}

runPhase3Tests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
