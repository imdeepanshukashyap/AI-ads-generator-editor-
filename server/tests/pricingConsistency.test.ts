import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { PAYMENT_CURRENCY, PURCHASABLE_PLANS } from '../services/paymentService.js';

/**
 * The prices customers see (client/src/configs/pricing.ts) must match what the
 * server asks Razorpay to charge and the credits it grants (PURCHASABLE_PLANS).
 * The client file is read as text, so this runs without building the client.
 */
const clientPricingUrl = new URL('../../client/src/configs/pricing.ts', import.meta.url);
const schemaUrl = new URL('../prisma/schema.prisma', import.meta.url);
const clientPricing = fs.existsSync(clientPricingUrl) ? fs.readFileSync(clientPricingUrl, 'utf8') : null;

const displayedPacks = () =>
    [...clientPricing!.matchAll(/\{\s*id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*pricePaise:\s*(\d+),\s*credits:\s*(\d+)\s*\}/g)].map(
        ([, id, name, pricePaise, credits]) => ({ id, name, pricePaise: Number(pricePaise), credits: Number(credits) }),
    );

describe('displayed pricing matches what is charged', { skip: clientPricing ? false : 'client/src/configs/pricing.ts not found' }, () => {
    it('lists exactly the purchasable plans, with the charged amount, name and credits', () => {
        const server = Object.entries(PURCHASABLE_PLANS).map(([id, plan]) => ({
            id,
            name: plan.name,
            pricePaise: plan.price,
            credits: plan.credits,
        }));
        assert.deepEqual(displayedPacks(), server);
    });

    it('uses the same currency', () => {
        assert.match(clientPricing!, new RegExp(`CURRENCY = '${PAYMENT_CURRENCY}'`));
    });

    it('shows the sign-up credits the database actually grants', () => {
        const displayed = Number(/FREE_SIGNUP_CREDITS = (\d+)/.exec(clientPricing!)?.[1]);
        const granted = Number(/credits\s+Int\s+@default\((\d+)\)/.exec(fs.readFileSync(schemaUrl, 'utf8'))?.[1]);
        assert.ok(Number.isFinite(displayed) && displayed > 0);
        assert.equal(displayed, granted);
    });
});
