import 'dotenv/config';
import Razorpay from 'razorpay';
import { checkRazorpayEnv } from '../services/razorpayGateway.js';

/**
 * Payment configuration check
 *
 * Applies the same validation the server uses at startup and reports which
 * payment-related variables are set and which Razorpay mode the keys belong to.
 * Never prints a value.
 *
 * Usage:
 *   npm run check:payments                # local checks only
 *   npm run check:payments -- --api       # also makes one read-only Razorpay API call
 *                                         # (lists 1 order; never charges) to prove the
 *                                         # key id and secret are a matching pair
 */
const REQUIRED = ['DATABASE_URL', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const;
const OPTIONAL = ['RAZORPAY_MODE', 'DIRECT_URL', 'CLIENT_URL', 'NODE_ENV'] as const;

const isSet = (name: string) => Boolean(process.env[name]?.trim());

async function main() {
    let problems = 0;

    console.log('Payment environment (values are never printed)');
    for (const name of REQUIRED) {
        console.log(`  ${name.padEnd(24)} ${isSet(name) ? 'set' : 'MISSING'}`);
        if (!isSet(name)) problems++;
    }
    for (const name of OPTIONAL) {
        console.log(`  ${name.padEnd(24)} ${isSet(name) ? 'set' : 'not set (optional)'}`);
    }

    const { mode, errors, warnings } = checkRazorpayEnv(process.env);
    if (mode) console.log(`\n  Razorpay key mode: ${mode.toUpperCase()}${isSet('RAZORPAY_MODE') ? ` (RAZORPAY_MODE=${process.env.RAZORPAY_MODE!.trim().toLowerCase()})` : ''}`);
    // Missing keys are already counted above.
    for (const error of errors.filter((e) => !e.includes('must both be set'))) {
        console.log(`  ERROR: ${error}. The server keeps payments disabled.`);
        problems++;
    }
    for (const warning of warnings.filter((w) => !w.includes('is not set'))) {
        console.log(`  WARNING: ${warning}.`);
    }

    if (process.argv.includes('--api')) {
        const keyId = process.env.RAZORPAY_KEY_ID?.trim();
        const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
        if (!keyId || !keySecret || !mode || errors.length > 0) {
            // Never call Razorpay with a configuration the server itself would refuse (e.g. live keys with RAZORPAY_MODE=test).
            console.log('\n  API check skipped: fix the configuration above first.');
            problems++;
        } else {
            try {
                const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
                await client.orders.all({ count: 1 });
                console.log(`\n  API check: Razorpay accepted the ${mode} key id and secret (read-only call, nothing charged).`);
            } catch (error: any) {
                const detail = error?.error?.description || error?.message || 'unknown error';
                console.log(`\n  API check FAILED (${error?.statusCode ?? 'no status'}): ${detail}`);
                if (error?.statusCode === 401) {
                    console.log('  The key id and secret do not belong together (different mode or account), or the key was regenerated.');
                }
                problems++;
            }
        }
    }

    console.log(problems === 0 ? '\nOK' : `\n${problems} problem(s) found.`);
    process.exit(problems === 0 ? 0 : 1);
}

main();
