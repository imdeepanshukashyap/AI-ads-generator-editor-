import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRazorpayEnv } from '../services/razorpayGateway.js';

const TEST_KEY = 'rzp_test_AbCdEf123456';
const LIVE_KEY = 'rzp_live_AbCdEf123456';
const SECRET = 'not_a_real_key_secret_value';
const WEBHOOK = 'not_a_real_webhook_secret_value';

const check = (env: Record<string, string | undefined>) => checkRazorpayEnv(env as NodeJS.ProcessEnv);

describe('checkRazorpayEnv', () => {
    it('accepts a complete live configuration with no warnings', () => {
        const result = check({ RAZORPAY_KEY_ID: LIVE_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK, RAZORPAY_MODE: 'live', NODE_ENV: 'production' });
        assert.deepEqual(result, { mode: 'live', errors: [], warnings: [] });
    });

    it('fails closed when keys are missing or malformed', () => {
        assert.equal(check({}).errors.length, 1);
        assert.equal(check({ RAZORPAY_KEY_ID: LIVE_KEY }).errors.length, 1);
        assert.equal(check({ RAZORPAY_KEY_ID: 'live_AbCdEf', RAZORPAY_KEY_SECRET: SECRET }).errors.length, 1);
    });

    it('fails closed when RAZORPAY_MODE and the key id disagree (half-finished switch)', () => {
        const testKeysInLive = check({ RAZORPAY_KEY_ID: TEST_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK, RAZORPAY_MODE: 'live' });
        assert.match(testKeysInLive.errors.join(), /RAZORPAY_MODE is "live" but RAZORPAY_KEY_ID is a test key/);

        const liveKeysInTest = check({ RAZORPAY_KEY_ID: LIVE_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK, RAZORPAY_MODE: 'test' });
        assert.match(liveKeysInTest.errors.join(), /RAZORPAY_MODE is "test" but RAZORPAY_KEY_ID is a live key/);

        assert.match(check({ RAZORPAY_KEY_ID: LIVE_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_MODE: 'prod' }).errors.join(), /must be "test" or "live"/);
    });

    it('accepts RAZORPAY_MODE in any case and with whitespace', () => {
        assert.deepEqual(check({ RAZORPAY_KEY_ID: LIVE_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK, RAZORPAY_MODE: ' LIVE ' }).errors, []);
    });

    it('warns about test keys in production unless RAZORPAY_MODE=test acknowledges it', () => {
        const base = { RAZORPAY_KEY_ID: TEST_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK, NODE_ENV: 'production' };
        assert.match(check(base).warnings.join(), /Production is using TEST keys/);
        assert.deepEqual(check({ ...base, RAZORPAY_MODE: 'test' }).warnings, []);
        assert.deepEqual(check({ ...base, NODE_ENV: 'development' }).warnings, []);
    });

    it('warns about a missing or reused webhook secret and a key id pasted as the secret', () => {
        assert.match(check({ RAZORPAY_KEY_ID: LIVE_KEY, RAZORPAY_KEY_SECRET: SECRET }).warnings.join(), /RAZORPAY_WEBHOOK_SECRET is not set/);
        assert.match(check({ RAZORPAY_KEY_ID: LIVE_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: SECRET }).warnings.join(), /equals the key secret/);
        assert.match(check({ RAZORPAY_KEY_ID: LIVE_KEY, RAZORPAY_KEY_SECRET: LIVE_KEY, RAZORPAY_WEBHOOK_SECRET: WEBHOOK }).warnings.join(), /looks like a key id/);
    });

    it('never includes secret or key values in its messages', () => {
        const all = [
            check({ RAZORPAY_KEY_ID: TEST_KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: SECRET, RAZORPAY_MODE: 'live', NODE_ENV: 'production' }),
            check({ RAZORPAY_KEY_ID: 'bad_key_value', RAZORPAY_KEY_SECRET: SECRET }),
        ].flatMap((r) => [...r.errors, ...r.warnings]).join('\n');
        for (const value of [TEST_KEY, SECRET, 'bad_key_value']) assert.ok(!all.includes(value), `message leaked ${value}`);
    });
});
