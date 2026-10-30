import { Link } from 'react-router-dom';
import LegalLayout, { BusinessValue, LegalList, LegalSection, PolicyLink } from '../components/LegalLayout';
import { plansData } from '../assets/dummy-data';
import { BRAND_NAME } from '../configs/business';

const paidPlans = plansData.filter((plan) => plan.id !== 'starter');
const freePlan = plansData.find((plan) => plan.id === 'starter');

const About = () => {
    return (
        <LegalLayout
            page="about"
            eyebrow="Company"
            intro={<p>{BRAND_NAME} turns product photos into ready-to-post marketing images and short videos using AI.</p>}
        >
            <LegalSection id="what" title="What we do">
                <p>
                    Upload photos of your product and a model photo, describe what you want, and {BRAND_NAME} generates lifestyle
                    images and short-form videos you can download and use in your marketing. You can also choose to publish your
                    generations to the community gallery.
                </p>
            </LegalSection>

            <LegalSection id="how" title="How it works">
                <LegalList>
                    <li>Create an account and receive {freePlan?.credits} free credits.</li>
                    <li>Generate a single image (5 credits), a 3-image bundle (up to 15 credits) or a video (10 credits).</li>
                    <li>Find everything you create under My Generations, ready to download.</li>
                    <li>
                        Need more credits? Buy a one-time credit pack ({paidPlans.map((p) => `${p.price} for ${p.credits} credits`).join(', ')})
                        on the{' '}
                        <Link to="/plans" onClick={() => scrollTo(0, 0)} className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200">
                            Plans page
                        </Link>
                        . Payments are processed securely by Razorpay. There is no subscription.
                    </li>
                </LegalList>
            </LegalSection>

            <LegalSection id="who" title="Who we are">
                <p>
                    {BRAND_NAME} is operated by <BusinessValue field="legalName" />, <BusinessValue field="businessAddress" />.
                </p>
                <p>
                    Questions or feedback? Visit <PolicyLink to="contact" />.
                </p>
            </LegalSection>
        </LegalLayout>
    );
};

export default About;
