import { UploadIcon, VideoIcon, ZapIcon } from 'lucide-react';
import { POLICY_LINKS } from '../configs/business';
import { CREDIT_PACKS, FREE_SIGNUP_CREDITS, formatInr } from '../configs/pricing';

export const featuresData = [
    {
        icon: <UploadIcon className="w-6 h-6" />,
        title: 'Smart Upload',
        desc: 'Drag & drop your assets. We auto-optimize formats and sizes.'
    },
    {
        icon: <ZapIcon className="w-6 h-6" />,
        title: 'Instant Generation',
        desc: 'Optimized models deliver output in seconds with great fidelity.'
    },
    {
        icon: <VideoIcon className="w-6 h-6" />,
        title: 'Video Synthesis',
        desc: 'Bring product shots to life with short-form, social-ready videos.'
    }
];

// Display data only, built from configs/pricing.ts. What a purchase actually
// costs and grants is decided by the server (PURCHASABLE_PLANS).
export const plansData = [
    {
        id: 'starter',
        name: 'Free',
        price: formatInr(0),
        desc: 'Free credits when you sign up',
        credits: FREE_SIGNUP_CREDITS,
        features: [
            `${FREE_SIGNUP_CREDITS} free credits on sign-up`,
            'Image: 5 credits · 3-image bundle: up to 15 · Video: 10',
            'No payment details required'
        ],
        popular: false
    },
    ...CREDIT_PACKS.map((pack) => ({
        id: pack.id,
        name: pack.name,
        price: formatInr(pack.pricePaise),
        desc: 'One-time credit pack',
        credits: pack.credits,
        features: [
            `${pack.credits} credits added to your account`,
            'Use credits on images, 3-image bundles and videos',
            'One-time payment, no subscription',
            'Credits added once payment is confirmed'
        ],
        popular: pack.id === 'pro'
    }))
];

export const faqData = [
    {
        question: 'How does the AI generation work?',
        answer: 'We leverage state-of-the-art diffusion models trained on millions of product images to blend your product into realistic scenes while preserving details, lighting and reflections.'
    },
    {
        question: 'Do I own the generated images?',
        answer: 'Subject to our Terms & Conditions and applicable law, you may use the images and videos you generate, including for commercial purposes. You must have the rights and consent needed for every product and person image you upload.'
    },
    {
        question: 'Is this a subscription? Can I cancel?',
        answer: 'There is no subscription. Credit packs are one-time purchases, so there is no recurring billing to cancel. See our Refund, Cancellation & Credit Policy for refunds and how credits are used.'
    },
    {
        question: 'What input formats do you support?',
        answer: 'We accept JPG, PNG and WEBP. Outputs are high-resolution PNGs and MP4s optimized for social platforms.'
    }
];

export const footerLinks = [
    {
        title: "Quick Links",
        links: [
            { name: "Home", url: "/" },
            { name: "Features", url: "#" },
            { name: "Pricing", url: "/plans" },
            { name: "FAQ", url: "#" }
        ]
    },
    {
        title: "Legal & Support",
        links: Object.values(POLICY_LINKS).map(({ label, path }) => ({ name: label, url: path }))
    },
    {
        title: "Connect",
        links: [
            { name: "Twitter", url: "#" },
            { name: "LinkedIn", url: "#" },
            { name: "GitHub", url: "#" }
        ]
    }
];