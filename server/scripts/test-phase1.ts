import crypto from 'crypto';
import { encrypt, decrypt } from '../utils/crypto.js';
import { signState, verifyState } from '../utils/oauthState.js';

// Setup test encryption key (32 bytes base64) if not present
if (!process.env.SOCIAL_TOKEN_ENC_KEY) {
    const randomKey = crypto.randomBytes(32).toString('base64');
    process.env.SOCIAL_TOKEN_ENC_KEY = randomKey;
    console.log('[Test Setup] Generated test SOCIAL_TOKEN_ENC_KEY');
}

async function runPhase1Tests() {
    console.log('\n========================================');
    console.log('🧪 RUNNING PHASE 1 VERIFICATION TESTS');
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
    // TEST 1: Crypto Round-Trip (AES-256-GCM)
    // ----------------------------------------------------
    console.log('🔹 [Test 1] AES-256-GCM Encryption / Decryption Round-Trip');
    const sampleToken = 'ya29.a0AfH6SMB_sample_google_youtube_access_token_xyz987';
    const encrypted = encrypt(sampleToken);
    
    assert(typeof encrypted === 'string' && encrypted.split(':').length === 3, 'Ciphertext has format iv:authTag:ciphertext');
    assert(encrypted !== sampleToken, 'Ciphertext does not contain raw token');
    
    const decrypted = decrypt(encrypted);
    assert(decrypted === sampleToken, 'Decrypted text strictly equals original token');

    // Test distinct IVs
    const encrypted2 = encrypt(sampleToken);
    assert(encrypted !== encrypted2, 'Two encryptions of same plaintext produce different ciphertexts (random IV)');

    // ----------------------------------------------------
    // TEST 2: Tamper Resistance (Auth Tag Verification)
    // ----------------------------------------------------
    console.log('\n🔹 [Test 2] Tamper Resistance & Authentication Tag Verification');
    const [ivHex, authTagHex, cipherHex] = encrypted.split(':');
    // Tamper with ciphertext by flipping last hex char
    const tamperedCipher = cipherHex.slice(0, -1) + (cipherHex.slice(-1) === 'a' ? 'b' : 'a');
    const tamperedPayload = `${ivHex}:${authTagHex}:${tamperedCipher}`;
    
    let caughtTamper = false;
    try {
        decrypt(tamperedPayload);
    } catch {
        caughtTamper = true;
    }
    assert(caughtTamper, 'Tampered ciphertext is rejected by GCM authentication tag verification');

    // ----------------------------------------------------
    // TEST 3: OAuth State Token Signing & Verification
    // ----------------------------------------------------
    console.log('\n🔹 [Test 3] OAuth State Token Signing & Verification');
    const testUserId = 'user_clerk_2tSampleId999';
    const state = signState(testUserId, 'youtube');

    assert(typeof state === 'string' && state.includes('.'), 'OAuth state token has payload.signature format');

    const verified = verifyState(state);
    assert(verified !== null, 'Valid OAuth state token verifies successfully');
    assert(verified?.userId === testUserId, 'Verified state contains correct userId');
    assert(verified?.platform === 'youtube', 'Verified state contains correct platform');

    // ----------------------------------------------------
    // TEST 4: OAuth State Tampering
    // ----------------------------------------------------
    console.log('\n🔹 [Test 4] OAuth State Tamper Rejection');
    const [statePayload, stateSig] = state.split('.');
    const tamperedState = `${statePayload}.tampered_signature_12345`;
    const verifiedTampered = verifyState(tamperedState);
    assert(verifiedTampered === null, 'Tampered OAuth state signature is rejected');

    console.log('\n========================================');
    console.log(`📊 RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('========================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runPhase1Tests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
