import LegalLayout, { BusinessValue, LegalList, LegalSection, PolicyLink } from '../components/LegalLayout';
import { plansData } from '../assets/dummy-data';
import { BRAND_NAME } from '../configs/business';

const paidPlans = plansData.filter((plan) => plan.id !== 'starter');
const freePlan = plansData.find((plan) => plan.id === 'starter');

const RefundPolicy = () => {
    return (
        <LegalLayout
            page="refund"
            intro={<p>How {BRAND_NAME} credits are sold, delivered and used, and how cancellations and refunds are handled.</p>}
        >
            <LegalSection id="overview" title="1. Credits">
                <p>
                    {BRAND_NAME} uses credits to pay for AI generations. New accounts receive {freePlan?.credits} free credits at sign-up.
                    You can buy more credits as one-time credit packs. Credits are digital and are linked to your account.
                </p>
            </LegalSection>

            <LegalSection id="packs" title="2. Credit packs and prices">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="text-gray-400">
                            <tr className="border-b border-white/10">
                                <th className="py-2 pr-4 font-medium">Pack</th>
                                <th className="py-2 pr-4 font-medium">Price (INR)</th>
                                <th className="py-2 font-medium">Credits</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paidPlans.map((plan) => (
                                <tr key={plan.id} className="border-b border-white/5">
                                    <td className="py-2 pr-4 text-white">{plan.name}</td>
                                    <td className="py-2 pr-4">{plan.price}</td>
                                    <td className="py-2">{plan.credits}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <LegalList>
                    <li>The amount shown in the Razorpay checkout is the total you are charged.</li>
                    <li>Credit packs are one-time purchases. There is no subscription, recurring charge or automatic renewal.</li>
                    <li>Payments are processed by Razorpay.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="delivery" title="3. Delivery">
                <p>
                    No physical goods are shipped. Credits are added to your account automatically after Razorpay confirms your payment to our
                    servers, normally right after checkout. If you close your browser before this completes, the credits are added when we
                    receive Razorpay’s payment confirmation. If your payment succeeded but the credits do not appear, contact us with your
                    order ID and payment ID and we will check the payment with Razorpay.
                </p>
            </LegalSection>

            <LegalSection id="usage" title="4. How credits are used">
                <LegalList>
                    <li>
                        <strong className="text-white">Single image — 5 credits.</strong> Credits are deducted only after the image has been
                        generated and saved. If generation fails, no credits are deducted.
                    </li>
                    <li>
                        <strong className="text-white">3-image bundle — up to 15 credits.</strong> You need at least 15 credits to start.
                        5 credits are deducted for each image generated successfully. If no image is generated, no credits are deducted.
                    </li>
                    <li>
                        <strong className="text-white">Video — 10 credits.</strong> You need at least 10 credits to start, and 10 credits are
                        reserved when generation begins. If generation then fails (for example because of a provider error, a timeout or a
                        safety filter), the Service is designed to return the reserved credits automatically. If credits are not returned
                        after a failed video, contact us and we will review it.
                    </li>
                    <li>
                        Credits are used for every successful generation, whether or not you are happy with the creative result, because AI
                        output varies from one generation to the next.
                    </li>
                    <li>Credits do not currently expire.</li>
                    <li>Credits have no cash value and cannot be transferred between accounts.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="cancellation" title="5. Cancellation">
                <p>
                    Because credit packs are one-time purchases, there is no subscription to cancel. You can cancel a purchase before paying
                    by closing the Razorpay checkout; you are not charged. Once a payment is confirmed, the credits are delivered
                    immediately, so a request to reverse a completed purchase is handled as a refund request under section 6.
                </p>
            </LegalSection>

            <LegalSection id="refunds" title="6. Refunds">
                <LegalList>
                    <li>
                        <strong className="text-white">Failed payments.</strong> If a payment fails, no credits are added. If your account was
                        debited for a payment that failed, the reversal is handled by Razorpay and your bank or payment provider. Contact us
                        with your order ID if it is not reversed.
                    </li>
                    <li>
                        <strong className="text-white">Paid but no credits.</strong> If your payment succeeded but no credits were added, we
                        will verify the payment with Razorpay and add the credits to your account.
                    </li>
                    <li>
                        <strong className="text-white">Refunds of completed purchases.</strong> <BusinessValue field="refundEligibility" />
                    </li>
                    <li>Refund requests must be made within: <BusinessValue field="refundRequestWindow" />.</li>
                    <li>
                        Approved refunds are issued through Razorpay to the original payment method. After a refund is issued, banks and
                        payment providers usually take 5–7 working days to credit it, and sometimes longer.
                    </li>
                    <li>
                        A payment that is refunded before its credits were added never adds credits. If a purchase is refunded after its
                        credits were added, we may remove those credits from your account.
                    </li>
                    <li>Free sign-up credits have no cash value and are not refundable.</li>
                    <li>Unused credits on account suspension or termination: <BusinessValue field="unusedCreditsOnTermination" />.</li>
                </LegalList>
            </LegalSection>

            <LegalSection id="how-to-request" title="7. How to request help or a refund">
                <p>Email <BusinessValue field="supportEmail" link="email" /> with:</p>
                <LegalList>
                    <li>the email address of your {BRAND_NAME} account;</li>
                    <li>the Razorpay order ID (starts with “order_”) and payment ID (starts with “pay_”), which you can find in the payment confirmation Razorpay sends you;</li>
                    <li>the date and amount of the payment, and a short description of the issue.</li>
                </LegalList>
                <p className="text-amber-200">
                    Never share your card number, CVV, OTP, UPI PIN or passwords. We will never ask for them.
                </p>
                <p>
                    Typical response time: <BusinessValue field="supportResponseTime" />. See <PolicyLink to="contact" /> for all support
                    options.
                </p>
            </LegalSection>
        </LegalLayout>
    );
};

export default RefundPolicy;
