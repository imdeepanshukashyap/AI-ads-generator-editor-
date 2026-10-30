import LegalLayout, { BusinessValue, LegalList, LegalSection, PolicyLink } from '../components/LegalLayout';
import { BRAND_NAME } from '../configs/business';

const PrivacyPolicy = () => {
    return (
        <LegalLayout
            page="privacy"
            intro={<p>This policy explains what information {BRAND_NAME} collects, how it is used and shared, and the choices you have.</p>}
        >
            <LegalSection id="who-we-are" title="1. Who we are">
                <p>
                    {BRAND_NAME} (the “Service”) is operated by <BusinessValue field="legalName" /> (
                    <BusinessValue field="operatorType" />),{' '}
                    <BusinessValue field="businessAddress" /> (“we”, “us”, “our”). For privacy questions, contact{' '}
                    <BusinessValue field="supportEmail" link="email" />.
                </p>
            </LegalSection>

            <LegalSection id="information-we-collect" title="2. Information we collect">
                <LegalList>
                    <li>
                        <strong className="text-white">Account information.</strong> Sign-up and sign-in are handled by our authentication
                        provider, Clerk. We receive and store your account identifier, email address, name and profile image link. If you sign
                        in with another account (for example, Google), Clerk receives the information that provider shares. We do not receive
                        your password.
                    </li>
                    <li>
                        <strong className="text-white">Images and text you submit.</strong> The product image and model (person) image you
                        upload, and your project details: project name, product name, product description, prompt, aspect ratio and narration
                        language.
                    </li>
                    <li>
                        <strong className="text-white">Generated content.</strong> The images and videos the Service generates for you, and any
                        error message recorded if a generation fails.
                    </li>
                    <li>
                        <strong className="text-white">Credits and purchases.</strong> Your credit balance and, for each purchase, the plan,
                        amount, currency, credits, status, and the Razorpay order ID, payment ID and payment signature. Card, UPI, net-banking
                        and wallet details are entered in Razorpay’s checkout and are not received or stored by us. Your name and email
                        address are pre-filled into the checkout form.
                    </li>
                    <li>
                        <strong className="text-white">Technical information.</strong> When you use the Service, our servers record your IP
                        address, browser user agent, the pages and API endpoints you request (including query parameters), timestamps, request
                        identifiers and error details. Error reports sent to our error-monitoring provider may include similar request and
                        device information.
                    </li>
                </LegalList>
            </LegalSection>

            <LegalSection id="how-we-use" title="3. How we use information">
                <LegalList>
                    <li>To provide the Service: signing you in, generating, storing and displaying your images and videos.</li>
                    <li>To process purchases: creating payment orders, verifying payments with Razorpay and adding credits to your account.</li>
                    <li>To keep your credit balance and generation history.</li>
                    <li>To detect, prevent and investigate fraud, abuse and security incidents.</li>
                    <li>To diagnose errors and keep the Service reliable.</li>
                    <li>To respond to support requests and to comply with legal obligations.</li>
                </LegalList>
                <p>We do not sell your personal information.</p>
            </LegalSection>

            <LegalSection id="ai-processing" title="4. AI processing of your content">
                <p>We create images and videos with Google’s generative AI models, which we access through Google’s Gemini API:</p>
                <LegalList>
                    <li>
                        <strong className="text-white">Images.</strong> The product image and model (person) image you upload, together with
                        your prompt, are sent to Google’s Gemini image model, which returns the generated image to our servers.
                    </li>
                    <li>
                        <strong className="text-white">Videos.</strong> The generated image you choose, together with your product name, product
                        description, prompt and narration language, is sent to Google’s Veo video model. Our servers then download the finished
                        video from Google.
                    </li>
                </LegalList>
                <p>
                    Google processes this content under its own terms. <BusinessValue field="aiProviderDataUse" /> Google also adds an
                    invisible SynthID watermark to every image its Gemini image models generate.
                </p>
                <p>
                    Because you upload images of people, generated images and videos may depict those people. Generated images and videos are
                    stored with our media storage provider.
                </p>
            </LegalSection>

            <LegalSection id="public-gallery" title="5. Publishing to the Community gallery">
                <p>
                    Your projects are private unless you publish them. When you publish a project, it appears in the public Community
                    gallery, where anyone — including people who are not signed in — can see the generated images and video, the product and
                    model images you uploaded, the product name, product description, prompt, aspect ratio and dates. The public project data
                    also includes an internal account identifier.
                </p>
                <p>
                    You can unpublish a project at any time from My Generations. People may already have viewed or saved it while it was
                    public.
                </p>
            </LegalSection>

            <LegalSection id="media-links" title="6. Media links">
                <p>
                    Uploaded and generated media files are stored with Cloudinary and delivered through web links that are not
                    access-controlled: anyone who has a file’s link can open it. Share links with care.
                </p>
            </LegalSection>

            <LegalSection id="sharing" title="7. Service providers and sharing">
                <p>We share information with these providers only as needed to run the Service:</p>
                <LegalList>
                    <li><strong className="text-white">Clerk</strong> — authentication and account management.</li>
                    <li><strong className="text-white">Razorpay</strong> — payment processing.</li>
                    <li><strong className="text-white">Google</strong> — AI image and video generation.</li>
                    <li><strong className="text-white">Cloudinary</strong> — storage and delivery of uploaded and generated media.</li>
                    <li><strong className="text-white">Sentry</strong> — error monitoring.</li>
                    <li><strong className="text-white">Vercel and Render</strong> — hosting of our website and API.</li>
                    <li><strong className="text-white">A managed PostgreSQL database provider</strong> — storage of account, project and purchase records.</li>
                </LegalList>
                <p>
                    Our website also loads fonts from Google Fonts, home-page images from Unsplash, and Razorpay’s checkout script. These
                    providers receive your IP address and browser information when your browser loads their content.
                </p>
                <p>
                    Each provider processes information under its own terms and privacy policy, and some may process it outside your country.
                    We may also disclose information where required by law or to protect the rights and safety of our users, the public or
                    the Service.
                </p>
            </LegalSection>

            <LegalSection id="cookies" title="8. Cookies and similar technologies">
                <p>
                    Clerk uses cookies and similar browser storage to keep you signed in. Razorpay’s checkout may use cookies to process
                    payments and prevent fraud. We do not currently use advertising cookies or third-party analytics. Blocking cookies may
                    stop sign-in or payments from working.
                </p>
            </LegalSection>

            <LegalSection id="retention" title="9. Retention and deletion">
                <LegalList>
                    <li>Account, project and purchase records are kept while your account exists.</li>
                    <li>
                        Deleting a project from My Generations removes it from your account, from the Community gallery and from our database.
                        The media files themselves are not automatically deleted from our media storage provider at that time; contact us to
                        request their deletion.
                    </li>
                    <li>
                        When your account is deleted, your account record, projects and purchase records are deleted from our application
                        database. Media files may remain in media storage until removed on request. Razorpay keeps its own payment records
                        under its policies.
                    </li>
                    <li>
                        Server logs are kept for troubleshooting and security. Log files on our servers are rotated by size, so older entries
                        are overwritten over time, and our hosting provider keeps server output under its own retention settings. Error
                        reports are kept by our error-monitoring provider, Sentry, under its retention settings.
                    </li>
                    <li>We do not otherwise apply fixed retention periods: the records above are kept until they are deleted as described in this section.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="security" title="10. Security">
                <p>
                    We rely on the access controls and encrypted connections provided by our hosting and service providers, and we confirm
                    every payment with Razorpay on our servers before adding credits. No method of transmission or storage is completely
                    secure, so we cannot guarantee absolute security.
                </p>
            </LegalSection>

            <LegalSection id="your-choices" title="11. Your choices and rights">
                <LegalList>
                    <li>Update your name, email address or profile image in your account settings.</li>
                    <li>Download, unpublish or delete your projects from My Generations.</li>
                    <li>
                        Ask us to access, correct or delete your personal information, to delete media files, or to delete your account by
                        contacting <BusinessValue field="supportEmail" link="email" />. Typical response time:{' '}
                        <BusinessValue field="supportResponseTime" />.
                    </li>
                    <li>Depending on where you live, you may have additional rights under applicable data-protection law.</li>
                    <li>
                        Grievances: <BusinessValue field="grievanceOfficerName" />, <BusinessValue field="grievanceOfficerEmail" link="email" />.
                    </li>
                </LegalList>
            </LegalSection>

            <LegalSection id="children" title="12. Children">
                <p>
                    The Service is not intended for anyone under the minimum age: <BusinessValue field="minimumAge" />. Do not upload images
                    of children unless you are their parent or legal guardian.
                </p>
            </LegalSection>

            <LegalSection id="changes" title="13. Changes to this policy">
                <p>
                    We will post any changes to this policy on this page and update the effective date. See also our{' '}
                    <PolicyLink to="terms" /> and <PolicyLink to="refund" />.
                </p>
            </LegalSection>
        </LegalLayout>
    );
};

export default PrivacyPolicy;
