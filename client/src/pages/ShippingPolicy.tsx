import LegalLayout, { BusinessValue, LegalList, LegalSection, PolicyLink } from '../components/LegalLayout';
import { BRAND_NAME } from '../configs/business';

const ShippingPolicy = () => {
    return (
        <LegalLayout
            page="shipping"
            intro={<p>{BRAND_NAME} sells digital credits and delivers digital content. Nothing is shipped physically.</p>}
        >
            <LegalSection id="no-shipping" title="1. No physical shipping">
                <p>
                    {BRAND_NAME} does not sell or ship physical goods, so there are no shipping charges, shipping addresses or courier
                    timelines.
                </p>
            </LegalSection>

            <LegalSection id="credits" title="2. Delivery of purchased credits">
                <LegalList>
                    <li>Credits are added to the {BRAND_NAME} account you were signed in to when you paid.</li>
                    <li>
                        Credits are added automatically once Razorpay confirms the payment to our servers, normally right after checkout.
                        If you close your browser before checkout finishes, they are added when we receive Razorpay’s payment confirmation.
                    </li>
                    <li>Your current balance is shown in the app after you sign in.</li>
                    <li>A failed or cancelled payment does not add credits.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="content" title="3. Delivery of generated content">
                <p>
                    Images and videos you generate appear in the app when generation finishes, and remain available under My Generations,
                    where you can download them.
                </p>
            </LegalSection>

            <LegalSection id="problems" title="4. If something does not arrive">
                <p>
                    If your payment succeeded but credits were not added, contact us at <BusinessValue field="supportEmail" link="email" />{' '}
                    with your Razorpay order ID (“order_…”) and payment ID (“pay_…”). We will check the payment with Razorpay and add the
                    credits if the payment was successful. See also our <PolicyLink to="refund" /> and <PolicyLink to="contact" />.
                </p>
            </LegalSection>
        </LegalLayout>
    );
};

export default ShippingPolicy;
