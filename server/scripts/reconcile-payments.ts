import 'dotenv/config';
import { prisma } from '../configs/prisma.js';
import { getPaymentConfig } from '../configs/razorpay.js';
import { reconcilePendingTransactions } from '../services/paymentService.js';

/**
 * Payment reconciliation
 *
 * Checks unpaid/failed orders against Razorpay and grants credits for any
 * captured, unrefunded payment that was never confirmed (browser closed before
 * /verify and the webhook was missed). Orders whose payment was refunded are
 * closed instead. Safe to re-run: every change is idempotent.
 *
 * Usage:
 *   npm run reconcile:payments                 # dry run - reports only
 *   npm run reconcile:payments -- --apply      # grant credits / mark failures / close refunded orders
 *   Options: --min-age-minutes=15 --max-age-days=30 --limit=100
 */
const readNumberArg = (name: string, fallback: number) => {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    const value = arg ? Number(arg.split('=')[1]) : fallback;
    return Number.isFinite(value) && value >= 0 ? value : fallback;
};

async function main() {
    const apply = process.argv.includes('--apply');
    const config = getPaymentConfig();
    if (!config) throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set');

    console.log(`Reconciling Razorpay orders (${apply ? 'APPLY' : 'DRY RUN'})...`);

    const summary = await reconcilePendingTransactions(config, {
        apply,
        minAgeMinutes: readNumberArg('min-age-minutes', 15),
        maxAgeDays: readNumberArg('max-age-days', 30),
        limit: readNumberArg('limit', 100),
    });

    console.log(`Checked ${summary.checked} order(s).`);
    for (const r of summary.results) {
        console.log(`  ${r.orderId}  ${r.outcome}${r.paymentId ? `  ${r.paymentId}` : ''}${r.error ? `  (${r.error})` : ''}`);
    }

    const needsReview = summary.results.filter((r) => r.outcome === 'mismatch' || r.outcome === 'error');
    if (needsReview.length > 0) {
        console.log(`\n${needsReview.length} order(s) need manual review in the Razorpay Dashboard.`);
    }
    if (!apply && summary.results.some((r) => r.outcome === 'would_credit' || r.outcome === 'would_mark_refunded')) {
        console.log('\nRe-run with --apply to grant the credits listed as would_credit and close orders listed as would_mark_refunded.');
    }
}

main()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
        console.error('Reconciliation failed:', error.message);
        await prisma.$disconnect();
        process.exit(1);
    });
