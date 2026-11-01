import type { ReactNode } from 'react';
import LegalLayout, { BusinessValue, LegalList, LegalSection, PolicyLink } from '../components/LegalLayout';
import { BRAND_NAME, BUSINESS, OPTIONAL_BUSINESS } from '../configs/business';

const DetailRow = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4 py-2 border-b border-white/5 last:border-0">
        <dt className="text-gray-400 sm:w-44 shrink-0">{label}</dt>
        <dd className="text-white">{children}</dd>
    </div>
);

const Contact = () => {
    return (
        <LegalLayout
            page="contact"
            eyebrow="Support"
            intro={<p>Need help with your account, a generation, credits or a payment? Here is how to reach the {BRAND_NAME} team.</p>}
        >
            <LegalSection id="support" title="Customer support">
                <dl className="text-sm">
                    <DetailRow label="Email"><BusinessValue field="supportEmail" link="email" /></DetailRow>
                    {BUSINESS.supportPhone && <DetailRow label="Phone"><BusinessValue field="supportPhone" link="phone" /></DetailRow>}
                    {BUSINESS.supportHours && <DetailRow label="Support hours"><BusinessValue field="supportHours" /></DetailRow>}
                    <DetailRow label="Response time"><BusinessValue field="supportResponseTime" /></DetailRow>
                </dl>
            </LegalSection>

            <LegalSection id="business" title="Business details">
                <dl className="text-sm">
                    <DetailRow label="Operated by"><BusinessValue field="legalName" /></DetailRow>
                    <DetailRow label="Business address"><BusinessValue field="businessAddress" /></DetailRow>
                    {OPTIONAL_BUSINESS.gstin && <DetailRow label="GSTIN">{OPTIONAL_BUSINESS.gstin}</DetailRow>}
                </dl>
            </LegalSection>

            <LegalSection id="payments" title="Payment or credit issues">
                <p>Please include:</p>
                <LegalList>
                    <li>the email address of your {BRAND_NAME} account;</li>
                    <li>the Razorpay order ID (“order_…”) and payment ID (“pay_…”) from your payment confirmation;</li>
                    <li>the date and amount of the payment, and what went wrong.</li>
                </LegalList>
                <p>
                    If your payment succeeded but your credits are missing, we will verify it with Razorpay and add the credits. For refunds
                    and cancellations, see our <PolicyLink to="refund" />.
                </p>
                <p className="text-amber-200">
                    Never share your card number, CVV, OTP, UPI PIN or passwords. We will never ask for them.
                </p>
            </LegalSection>

            <LegalSection id="data-requests" title="Account and data requests">
                <p>
                    Contact us to access, correct or delete your personal information, to delete uploaded or generated media files, or to
                    delete your account. You can unpublish or delete individual projects yourself from My Generations. See our{' '}
                    <PolicyLink to="privacy" /> for details.
                </p>
            </LegalSection>

            <LegalSection id="grievance" title="Grievance officer">
                <dl className="text-sm">
                    <DetailRow label="Name"><BusinessValue field="grievanceOfficerName" /></DetailRow>
                    <DetailRow label="Email"><BusinessValue field="grievanceOfficerEmail" link="email" /></DetailRow>
                </dl>
            </LegalSection>
        </LegalLayout>
    );
};

export default Contact;
