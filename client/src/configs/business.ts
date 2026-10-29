/**
 * Business details and policy decisions shown on the legal and support pages.
 *
 * Every `null` value renders as a visible "[To be provided: …]" placeholder, and
 * the policy pages show a notice while any remain. Replace each one with
 * verified information (and have the policies reviewed) before submitting the
 * site for Razorpay live activation. Do not fill these with guesses.
 */
export const BRAND_NAME = 'AdGen Studio';

export const BUSINESS_FIELDS = {
    // Business identity
    legalName: 'Legal business name (registered entity or proprietor)',
    operatorType: 'Operator type (individual proprietor or registered entity)',
    businessAddress: 'Registered business address',
    // Support
    supportEmail: 'Support email address',
    supportPhone: 'Support phone number',
    supportHours: 'Support hours and time zone',
    supportResponseTime: 'Typical support response time',
    grievanceOfficerName: 'Grievance officer name',
    grievanceOfficerEmail: 'Grievance officer email address',
    // Policy decisions
    policiesEffectiveDate: 'Effective date of these policies',
    minimumAge: 'Minimum age to use the service',
    governingLaw: 'Governing law and courts with jurisdiction',
    liabilityCap: 'Maximum aggregate liability',
    refundEligibility: 'Refund eligibility for purchased credit packs (for example, whether unused credits can be refunded)',
    refundRequestWindow: 'Time limit for requesting a refund',
    unusedCreditsOnTermination: 'Treatment of unused credits if an account is suspended or terminated',
    aiProviderDataUse: 'Whether the Google API plan in use allows Google to use submitted content to improve its services',
} as const;

export type BusinessField = keyof typeof BUSINESS_FIELDS;

export const BUSINESS: Record<BusinessField, string | null> = {
    // Provided by the owner on 2026-10-30.
    legalName: 'Naitik Sharma',
    operatorType: 'individual proprietor',
    businessAddress: '105-B, Alok Nagar, Jaipur House, Agra, Uttar Pradesh, 282010, India',
    supportEmail: 'sharmanaitik8111@gmail.com', // confirmed by the owner on 2026-10-30
    // Optional: the Contact page shows these rows only when set. Never fill with unverified details.
    supportPhone: null,
    supportHours: null,
    supportResponseTime: 'within 2 working days',
    grievanceOfficerName: 'Naitik Sharma',
    grievanceOfficerEmail: 'sharmanaitik8111@gmail.com',
    policiesEffectiveDate: 'October 30, 2026', // proposed effective date for the initial policies
    minimumAge: '18 years',
    // Terms decisions confirmed by the owner on 2026-10-30.
    governingLaw:
        'the laws of India; the courts at Agra, Uttar Pradesh have jurisdiction, without affecting any right you may have under consumer-protection law to bring a complaint in another forum permitted by law',
    liabilityCap: 'the total amount you paid us for credit packs in the 12 months before the claim arose',
    // Refund decisions confirmed by the owner on 2026-10-30.
    refundEligibility:
        'Purchased credit packs are generally non-refundable once their credits have been added to your account, except for duplicate charges, payments for which credits were not added, or where a refund is required by applicable law. We review each request individually.',
    refundRequestWindow:
        '7 days of the payment date; this limit does not apply to payment errors such as duplicate charges or payments for which credits were not added, and is subject to applicable law',
    // Shown in both the Terms and the Refund Policy, so the wording stays identical.
    unusedCreditsOnTermination:
        'if an account is suspended or terminated for a breach of the Terms, unused credits may be forfeited without a refund, except where applicable law requires otherwise; in other cases, we review unused purchased credits individually',
    // Paid Gemini API terms (ai.google.dev/gemini-api/terms). The owner confirmed billing is enabled
    // on 2026-10-30. True only while EVERY key the app uses (GOOGLE_CLOUD_API_KEY1/2) belongs to a
    // Cloud project with an active billing account; otherwise revert to wording covering unpaid use.
    aiProviderDataUse:
        'We use Google’s paid Gemini API service. Under Google’s terms for paid use, Google does not use your prompts, uploaded images or the generated output to improve its products. Google logs prompts and responses for a limited period, solely to detect and prevent violations of its Prohibited Use Policy and for any required legal or regulatory disclosures, and may store this data temporarily or cache it in any country where Google or its agents have facilities.',
};

/** Optional details: shown only when provided (no placeholder). */
export const OPTIONAL_BUSINESS = {
    gstin: null as string | null,
};

export const missingBusinessFields = () =>
    (Object.keys(BUSINESS) as BusinessField[]).filter((field) => !BUSINESS[field]);

// Razorpay's website review looks for About us, Contact us, Pricing, Terms, Privacy,
// Cancellation/Refund and Shipping pages (pricing is /plans).
export const POLICY_LINKS = {
    about: { path: '/about', label: 'About Us' },
    privacy: { path: '/privacy-policy', label: 'Privacy Policy' },
    terms: { path: '/terms-and-conditions', label: 'Terms & Conditions' },
    refund: { path: '/refund-policy', label: 'Refund, Cancellation & Credit Policy' },
    shipping: { path: '/shipping-policy', label: 'Shipping & Delivery Policy' },
    contact: { path: '/contact', label: 'Contact & Support' },
} as const;

export type PolicyKey = keyof typeof POLICY_LINKS;
