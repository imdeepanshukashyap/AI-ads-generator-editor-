import LegalLayout, { BusinessValue, LegalList, LegalSection, PolicyLink } from '../components/LegalLayout';
import { BRAND_NAME } from '../configs/business';

const TermsAndConditions = () => {
    return (
        <LegalLayout
            page="terms"
            intro={<p>These terms govern your use of {BRAND_NAME}. By creating an account, generating content or buying credits, you agree to them.</p>}
        >
            <LegalSection id="about" title="1. About these terms">
                <p>
                    {BRAND_NAME} (the “Service”) is operated by <BusinessValue field="legalName" /> (<BusinessValue field="operatorType" />),{' '}
                    <BusinessValue field="businessAddress" />{' '}
                    (“we”, “us”, “our”). Our <PolicyLink to="privacy" /> and <PolicyLink to="refund" /> form part of these terms.
                </p>
            </LegalSection>

            <LegalSection id="accounts" title="2. Eligibility and accounts">
                <LegalList>
                    <li>You must be at least the minimum age to use the Service: <BusinessValue field="minimumAge" />.</li>
                    <li>Accounts are created and secured through our authentication provider, Clerk. Keep your sign-in details secure; you are responsible for activity on your account.</li>
                    <li>Provide accurate information and keep it up to date.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="service" title="3. The Service">
                <p>
                    The Service uses third-party AI models to generate advertising images and short videos from product and model images you
                    upload. Generation depends on those providers: requests can take time, fail, or be blocked by the providers’ safety
                    systems. We may change, suspend or discontinue features, and we do not guarantee that the Service will be uninterrupted.
                </p>
            </LegalSection>

            <LegalSection id="credits-payments" title="4. Credits, prices and payments">
                <LegalList>
                    <li>Generating content uses credits. The credit cost of each action is shown in the app before you start it.</li>
                    <li>Credit packs are sold at the prices in Indian Rupees (INR) shown on our Plans page. The amount shown in the Razorpay checkout is the total you are charged.</li>
                    <li>Credit packs are one-time purchases. There is no subscription or automatic renewal.</li>
                    <li>Payments are processed by Razorpay and are also subject to Razorpay’s terms. We do not receive or store your card, UPI or bank details.</li>
                    <li>Credits are added after Razorpay confirms your payment to our servers.</li>
                    <li>Credits have no cash value, are linked to your account, and cannot be transferred or exchanged except as stated in our <PolicyLink to="refund" />.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="your-content" title="5. Your content and permissions">
                <p>You keep the rights you have in the images and text you upload. By uploading content you confirm that:</p>
                <LegalList>
                    <li>you own the content or have all rights and licences needed to use it with the Service; and</li>
                    <li>every identifiable person in an image you upload has given consent for their image to be used to create advertising content, and for it to be published if you publish the project.</li>
                </LegalList>
                <p>
                    You allow us to host, store, copy, process and display your content — including sending it to our AI and service providers
                    — only as needed to operate the Service, and to show it publicly in the Community gallery if you publish it. You can
                    unpublish a project at any time.
                </p>
            </LegalSection>

            <LegalSection id="generated-content" title="6. Generated content">
                <LegalList>
                    <li>Subject to these terms, the rights of others and applicable law, you may use the images and videos you generate, including for commercial purposes.</li>
                    <li>AI output can be inaccurate. It may not faithfully reproduce your product or the person in your images, and similar output may be generated for other users.</li>
                    <li>Output may carry technical markers, such as invisible watermarks, added by our AI providers.</li>
                    <li>You are responsible for reviewing output before using it, and for making sure your advertising complies with applicable advertising, consumer-protection and platform rules, including any requirement to disclose AI-generated or altered content.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="acceptable-use" title="7. Acceptable use">
                <p>You must not use the Service to upload, create or publish content that:</p>
                <LegalList>
                    <li>uses a person’s image without their consent, impersonates a real person, or falsely suggests a person or brand endorses a product;</li>
                    <li>is sexually explicit, or depicts or sexualises minors in any way;</li>
                    <li>includes images of children, unless you are their parent or legal guardian;</li>
                    <li>is hateful, harassing, violent or defamatory;</li>
                    <li>promotes illegal products or services, or makes false or misleading advertising claims;</li>
                    <li>infringes intellectual-property, privacy or publicity rights.</li>
                </LegalList>
                <p>
                    You must not try to bypass credit charges, payment verification or security controls, interfere with the Service, or
                    access other users’ data.
                </p>
            </LegalSection>

            <LegalSection id="enforcement" title="8. Suspension and termination">
                <p>
                    We may remove or unpublish content and suspend or close accounts that breach these terms or put users, third parties or
                    the Service at risk. Unused credits in that situation: <BusinessValue field="unusedCreditsOnTermination" />. You may stop
                    using the Service at any time and request account deletion as described in our <PolicyLink to="privacy" />.
                </p>
            </LegalSection>

            <LegalSection id="third-parties" title="9. Third-party services">
                <p>
                    The Service relies on third parties including Clerk, Razorpay, Google and Cloudinary. Their services are governed by their
                    own terms, and we are not responsible for their availability or conduct.
                </p>
            </LegalSection>

            <LegalSection id="ip" title="10. Our intellectual property">
                <p>
                    The Service, including its software, design and branding, belongs to <BusinessValue field="legalName" />. These terms do
                    not give you any rights in it beyond using the Service as permitted here.
                </p>
            </LegalSection>

            <LegalSection id="disclaimers" title="11. Disclaimers">
                <p>
                    To the extent permitted by law, the Service and all generated content are provided “as is” and “as available”, without
                    warranties of any kind, including that output will be accurate, fit for a particular purpose or free of third-party
                    rights.
                </p>
            </LegalSection>

            <LegalSection id="liability" title="12. Limitation of liability">
                <p>
                    To the extent permitted by law, we are not liable for indirect, incidental, special or consequential losses, or for loss
                    of profits, revenue or data. Our total liability for all claims relating to the Service is limited to:{' '}
                    <BusinessValue field="liabilityCap" />. Nothing in these terms limits liability that cannot be limited by law.
                </p>
            </LegalSection>

            <LegalSection id="indemnity" title="13. Indemnity">
                <p>
                    To the extent permitted by law, you will compensate us for claims and losses arising from content you upload or publish,
                    or from your breach of these terms.
                </p>
            </LegalSection>

            <LegalSection id="law" title="14. Governing law and disputes">
                <p>Governing law and jurisdiction: <BusinessValue field="governingLaw" />.</p>
            </LegalSection>

            <LegalSection id="changes" title="15. Changes to these terms">
                <p>
                    We will post any changes to these terms on this page and update the effective date. Continuing to use the Service after
                    changes take effect means you accept them.
                </p>
            </LegalSection>

            <LegalSection id="contact" title="16. Contact">
                <p>
                    Questions about these terms: <BusinessValue field="supportEmail" link="email" />. See also <PolicyLink to="contact" />.
                </p>
            </LegalSection>
        </LegalLayout>
    );
};

export default TermsAndConditions;
