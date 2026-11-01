/**
 * Credit pack prices shown on the website.
 *
 * Display copy of PURCHASABLE_PLANS in server/services/paymentService.ts, which
 * decides what Razorpay actually charges and how many credits are granted.
 * server/tests/pricingConsistency.test.ts fails if the two drift apart, so
 * change both together. Keep this file to plain values: the test reads it as text.
 */
export const CURRENCY = 'INR';

// Granted at sign-up by the server (User.credits default in prisma/schema.prisma).
export const FREE_SIGNUP_CREDITS = 20;

export const CREDIT_PACKS = [
    { id: 'pro', name: 'Pro', pricePaise: 900, credits: 80 },
    { id: 'ultra', name: 'Premium', pricePaise: 2900, credits: 240 },
] as const;

/** 900 → "₹9"; 999 → "₹9.99". */
export const formatInr = (paise: number) => `₹${Number.isInteger(paise / 100) ? paise / 100 : (paise / 100).toFixed(2)}`;
