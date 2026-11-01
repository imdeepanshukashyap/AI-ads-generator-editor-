import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
    BRAND_NAME,
    BUSINESS,
    BUSINESS_FIELDS,
    POLICY_LINKS,
    type BusinessField,
    type PolicyKey,
} from '../configs/business';

// The business details each page displays, so the "still being finalised" notice
// appears only on pages that actually show a placeholder.
const PAGE_FIELDS: Record<PolicyKey, BusinessField[]> = {
    about: ['legalName', 'businessAddress'],
    privacy: ['policiesEffectiveDate', 'legalName', 'operatorType', 'businessAddress', 'supportEmail', 'aiProviderDataUse', 'supportResponseTime', 'grievanceOfficerName', 'grievanceOfficerEmail', 'minimumAge'],
    terms: ['policiesEffectiveDate', 'legalName', 'operatorType', 'businessAddress', 'minimumAge', 'unusedCreditsOnTermination', 'liabilityCap', 'governingLaw', 'supportEmail'],
    refund: ['policiesEffectiveDate', 'refundEligibility', 'refundRequestWindow', 'unusedCreditsOnTermination', 'supportEmail', 'supportResponseTime'],
    shipping: ['policiesEffectiveDate', 'supportEmail'],
    // supportPhone and supportHours are optional on Contact: their rows are hidden when unset.
    contact: ['supportEmail', 'supportResponseTime', 'legalName', 'businessAddress', 'grievanceOfficerName', 'grievanceOfficerEmail'],
};

export const Placeholder = ({ label }: { label: string }) => (
    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-300 ring-1 ring-amber-400/30">
        [To be provided: {label}]
    </span>
);

/** Renders a business detail, or a visible placeholder until it is configured. */
export const BusinessValue = ({ field, link }: { field: BusinessField; link?: 'email' | 'phone' }) => {
    const value = BUSINESS[field];
    if (!value) return <Placeholder label={BUSINESS_FIELDS[field]} />;

    const linkClass = 'text-indigo-300 underline underline-offset-2 hover:text-indigo-200 break-all';
    if (link === 'email') return <a href={`mailto:${value}`} className={linkClass}>{value}</a>;
    if (link === 'phone') return <a href={`tel:${value.replace(/[^\d+]/g, '')}`} className={linkClass}>{value}</a>;
    return <>{value}</>;
};

export const PolicyLink = ({ to, children }: { to: PolicyKey; children?: ReactNode }) => (
    <Link
        to={POLICY_LINKS[to].path}
        onClick={() => scrollTo(0, 0)}
        className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200"
    >
        {children ?? POLICY_LINKS[to].label}
    </Link>
);

export const LegalSection = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
    <section id={id} className="scroll-mt-28">
        <h2 className="text-xl font-semibold text-white mb-3">{title}</h2>
        <div className="space-y-3 text-sm leading-relaxed text-gray-300">{children}</div>
    </section>
);

export const LegalList = ({ children }: { children: ReactNode }) => (
    <ul className="list-disc space-y-2 pl-5 marker:text-indigo-400">{children}</ul>
);

interface LegalLayoutProps {
    page: PolicyKey;
    eyebrow?: string;
    intro?: ReactNode;
    children: ReactNode;
}

export default function LegalLayout({ page, eyebrow = 'Legal', intro, children }: LegalLayoutProps) {
    const title = POLICY_LINKS[page].label;

    useEffect(() => {
        const previousTitle = document.title;
        document.title = `${title} | ${BRAND_NAME}`;
        return () => {
            document.title = previousTitle;
        };
    }, [title]);

    const hasPlaceholders = PAGE_FIELDS[page].some((field) => !BUSINESS[field]);

    return (
        <div className="min-h-screen text-white p-6 md:p-12 my-28">
            <article className="max-w-3xl mx-auto">
                <header className="mb-10">
                    <p className="text-sm font-medium text-violet-400 uppercase tracking-wide mb-3">{eyebrow}</p>
                    <h1 className="text-3xl md:text-4xl font-semibold mb-4">{title}</h1>
                    {page !== 'contact' && page !== 'about' && (
                        <p className="text-sm text-gray-400">
                            Effective date: <BusinessValue field="policiesEffectiveDate" />
                        </p>
                    )}
                    {intro && <div className="text-gray-300 mt-4 leading-relaxed">{intro}</div>}
                </header>

                {hasPlaceholders && (
                    <div role="note" className="mb-8 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                        Some details on this page are still being finalised and are marked “To be provided”.
                    </div>
                )}

                <div className="glass-panel rounded-2xl p-6 md:p-10 space-y-10">{children}</div>

                <nav aria-label="Policies" className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                    {(Object.keys(POLICY_LINKS) as PolicyKey[])
                        .filter((key) => key !== page)
                        .map((key) => <PolicyLink key={key} to={key} />)}
                </nav>
            </article>
        </div>
    );
}
