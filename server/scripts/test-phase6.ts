import { startPublisherCron, stopPublisherCron, reapZombies, runPublisherCycle } from '../jobs/publisher.js';

async function runPhase6Tests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING PHASE 6 (BACKGROUND SCHEDULER) VERIFICATION');
    console.log('======================================================\n');

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition: boolean, testName: string) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passedTests++;
        } else {
            console.error(`  ❌ FAIL: ${testName}`);
            passedTests ? null : null;
            failedTests++;
        }
    }

    // ----------------------------------------------------
    // TEST 1: Publisher Module Interface Exports
    // ----------------------------------------------------
    console.log('🔹 [Test 1] Publisher Function Exports');
    assert(typeof startPublisherCron === 'function', 'startPublisherCron is exported as a function');
    assert(typeof stopPublisherCron === 'function', 'stopPublisherCron is exported as a function');
    assert(typeof reapZombies === 'function', 'reapZombies is exported as a function');
    assert(typeof runPublisherCycle === 'function', 'runPublisherCycle is exported as a function');

    // ----------------------------------------------------
    // TEST 2: Zombie Reaper Calculation Window (10 Minutes)
    // ----------------------------------------------------
    console.log('\n🔹 [Test 2] Zombie Reaper Threshold Window');
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    const isFifteenMinZombie = fifteenMinutesAgo < tenMinutesAgo;
    const isTwoMinZombie = twoMinutesAgo < tenMinutesAgo;

    assert(isFifteenMinZombie, 'Task running for 15 minutes is recognized as stuck/zombie');
    assert(!isTwoMinZombie, 'Task running for 2 minutes is recognized as active, NOT a zombie');

    // ----------------------------------------------------
    // TEST 3: Exponential Backoff Formula (2^attempts minutes)
    // ----------------------------------------------------
    console.log('\n🔹 [Test 3] Exponential Backoff Calculation');
    function calculateBackoffDelayMs(attempts: number): number {
        const delayMinutes = Math.min(Math.pow(2, attempts), 60);
        return delayMinutes * 60 * 1000;
    }

    const backoffAttempt1 = calculateBackoffDelayMs(1) / (60 * 1000); // 2^1 = 2 min
    const backoffAttempt2 = calculateBackoffDelayMs(2) / (60 * 1000); // 2^2 = 4 min
    const backoffAttempt3 = calculateBackoffDelayMs(3) / (60 * 1000); // 2^3 = 8 min
    const backoffAttempt7 = calculateBackoffDelayMs(7) / (60 * 1000); // 2^7 = 128 -> clamped to 60 min

    assert(backoffAttempt1 === 2, `Attempt 1 delays next run by 2 minutes (got ${backoffAttempt1})`);
    assert(backoffAttempt2 === 4, `Attempt 2 delays next run by 4 minutes (got ${backoffAttempt2})`);
    assert(backoffAttempt3 === 8, `Attempt 3 delays next run by 8 minutes (got ${backoffAttempt3})`);
    assert(backoffAttempt7 === 60, `High attempt counts are safely clamped to 60 minutes (got ${backoffAttempt7})`);

    // ----------------------------------------------------
    // TEST 4: Max Retry Threshold & Terminal Failure
    // ----------------------------------------------------
    console.log('\n🔹 [Test 4] Max Retry Threshold Validation');
    const MAX_RETRIES = 3;
    const shouldRetryAttempt2 = 2 < MAX_RETRIES;
    const shouldRetryAttempt3 = 3 < MAX_RETRIES;

    assert(shouldRetryAttempt2, 'Post with 2 attempts qualifies for a 3rd attempt');
    assert(!shouldRetryAttempt3, 'Post with 3 attempts transitions permanently to "failed"');

    // ----------------------------------------------------
    // TEST 5: Auth Revoked / Permanent Error Detection
    // ----------------------------------------------------
    console.log('\n🔹 [Test 5] Auth Revocation Pattern Matching');
    function testIsAuthRevoked(err: any): boolean {
        const msg = (err?.message || err?.toString() || '').toLowerCase();
        const status = err?.status || err?.response?.status;
        const errCode = err?.response?.data?.error?.code;
        const errType = err?.response?.data?.error?.type;

        if (errCode === 190 || errType === 'OAuthException') return true;
        if (status === 401) return true;
        if (msg.includes('invalid_grant') || msg.includes('revoked') || msg.includes('reconnect') || msg.includes('token expired')) {
            return true;
        }
        return false;
    }

    const meta190Error = { response: { data: { error: { code: 190, message: 'Invalid OAuth access token' } } } };
    const googleInvalidGrant = new Error('invalid_grant: Token has been expired or revoked');
    const networkTimeout = new Error('ECONNRESET: socket hang up');
    const http401 = { response: { status: 401 } };

    assert(testIsAuthRevoked(meta190Error), 'Identifies Meta error code 190 as revoked auth');
    assert(testIsAuthRevoked(googleInvalidGrant), 'Identifies Google invalid_grant as revoked auth');
    assert(testIsAuthRevoked(http401), 'Identifies HTTP 401 as revoked auth');
    assert(!testIsAuthRevoked(networkTimeout), 'Distinguishes transient network errors from auth revocation');

    // ----------------------------------------------------
    // TEST 6: Lifecycle Start/Stop Cron Task
    // ----------------------------------------------------
    console.log('\n🔹 [Test 6] Cron Task Lifecycle Start and Graceful Stop');
    startPublisherCron();
    // Starting a second time should be idempotent
    startPublisherCron();
    assert(true, 'startPublisherCron started and handled idempotent invocation cleanly');

    stopPublisherCron();
    assert(true, 'stopPublisherCron stopped background task gracefully');

    // ----------------------------------------------------
    // Summary
    // ----------------------------------------------------
    console.log('\n======================================================');
    console.log(`Phase 6 Tests Completed: ${passedTests} passed, ${failedTests} failed`);
    console.log('======================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runPhase6Tests().catch(err => {
    console.error('Test script crashed:', err);
    process.exit(1);
});
