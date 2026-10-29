import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { CheckIcon } from 'lucide-react';
import { plansData } from '../assets/dummy-data';
import { createOrder, verifyPayment } from '../services/payment';
import { PolicyLink } from './LegalLayout';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';

// The parts of Razorpay Checkout (loaded from checkout.js in index.html) used here.
interface RazorpaySuccessResponse {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
}

interface RazorpayPaymentFailedEvent {
    error?: { description?: string };
}

interface RazorpayCheckout {
    on(event: 'payment.failed', handler: (response: RazorpayPaymentFailedEvent) => void): void;
    open(): void;
}

declare global {
    interface Window {
        Razorpay?: new (options: object) => RazorpayCheckout;
    }
}

// Free credits are granted at sign-up; this plan is never sent to checkout.
const FREE_PLAN_ID = 'starter';

const serverMessage = (error: unknown): string | undefined =>
    isAxiosError<{ message?: string }>(error) ? error.response?.data?.message : undefined;

export default function Pricing() {
    const { user } = useUser();
    const { getToken } = useAuth();
    const { openSignUp } = useClerk();
    const navigate = useNavigate();
    const [loading, setLoading] = useState<string | null>(null);

    const handlePurchase = async (planId: string) => {
        if (planId === FREE_PLAN_ID) {
            if (!user) {
                openSignUp();
            } else {
                navigate('/generate');
                scrollTo(0, 0);
            }
            return;
        }

        if (!user) {
            toast.error('Please sign in to purchase a plan');
            return;
        }

        const Razorpay = window.Razorpay;
        if (!Razorpay) {
            toast.error('Payment checkout failed to load. Please refresh the page and try again.');
            return;
        }

        setLoading(planId);

        try {
            // Get Clerk authentication token
            const token = await getToken();
            if (!token) {
                toast.error('Authentication failed. Please sign in again.');
                setLoading(null);
                return;
            }

            // Create order on backend (price and credits are decided server-side)
            const orderData = await createOrder(planId, token);
            const plan = plansData.find(p => p.id === planId);

            // Only the server's key id is used, so Checkout can't open in a different mode or account
            if (!orderData.keyId) {
                toast.error('Payments are not configured correctly. Please try again later.');
                setLoading(null);
                return;
            }
            if (orderData.mode === 'test') {
                toast('Test mode: no real money will be charged.', { icon: '🧪', duration: 6000 });
            }

            // Razorpay checkout options
            const options = {
                key: orderData.keyId,
                amount: orderData.amount,
                currency: orderData.currency,
                name: 'AdGen Studio',
                description: `${plan?.name} credit pack (${plan?.credits} credits)`,
                order_id: orderData.orderId,
                handler: async function (response: RazorpaySuccessResponse) {
                    try {
                        // Get fresh Clerk token for verification
                        const verificationToken = await getToken();
                        if (!verificationToken) {
                            toast.error(`Authentication failed. If money was deducted, your credits will be added automatically once the payment is confirmed (order ${orderData.orderId}).`);
                            return;
                        }

                        // Verify payment on backend
                        const result = await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        }, verificationToken);

                        if (result.status === 'pending') {
                            toast(result.message, { icon: '⏳', duration: 10000 });
                            return;
                        }

                        toast.success(`Payment successful! ${result.credits} credits added to your account.`);

                        // Reload page to update credits
                        setTimeout(() => {
                            window.location.reload();
                        }, 1500);
                    } catch (error) {
                        console.error('Payment verification failed:', error);
                        toast.error(
                            `${serverMessage(error) || 'Payment verification failed.'} Need help? Contact support with order ID ${orderData.orderId}.`,
                            { duration: 10000 }
                        );
                    } finally {
                        setLoading(null);
                    }
                },
                prefill: {
                    name: user.fullName || '',
                    email: user.primaryEmailAddress?.emailAddress || '',
                },
                theme: {
                    color: '#6366f1'
                },
                modal: {
                    ondismiss: function () {
                        setLoading(null);
                        toast.error('Payment cancelled');
                    }
                }
            };

            const razorpay = new Razorpay(options);
            // Checkout stays open so the customer can retry; no credits are granted for failed attempts.
            razorpay.on('payment.failed', (response: RazorpayPaymentFailedEvent) => {
                toast.error(response?.error?.description || 'Payment failed. No credits were added — you can try again.');
            });
            razorpay.open();

        } catch (error) {
            console.error('Order creation failed:', error);
            toast.error(serverMessage(error) || 'Failed to create order');
            setLoading(null);
        }
    };

    return (
        <section id="pricing" className="py-20 bg-gradient-to-b from-[#0a0a1f] to-[#1a1a2e]">
            <div className="max-w-6xl mx-auto px-4">
                {/* Header */}
                <div className="text-center mb-16">
                    <p className="text-indigo-400 text-sm font-semibold tracking-wider uppercase mb-3">PRICING</p>
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Pricing Plans</h2>
                    <p className="text-gray-400 text-lg max-w-2xl mx-auto">
                        Our Pricing Plans are simple, transparent and flexible. Choose the plan that best suits your needs.
                    </p>
                </div>

                {/* Pricing Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                    {plansData.map((plan) => (
                        <div
                            key={plan.id}
                            className={`relative rounded-2xl p-8 backdrop-blur-sm transition-all duration-300 hover:scale-105 ${plan.popular
                                ? 'bg-gradient-to-br from-indigo-600/20 via-purple-600/20 to-pink-600/20 border-2 border-indigo-500/50 shadow-xl shadow-indigo-500/20'
                                : 'bg-white/5 border border-white/10 hover:border-white/20'
                                }`}
                        >
                            {/* Plan Header */}
                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                                <p className="text-gray-400 text-sm mb-4">{plan.desc}</p>

                                {/* Price */}
                                <div className="flex items-baseline gap-1 mb-1">
                                    <span className="text-5xl font-bold text-white">{plan.price}</span>
                                    {plan.id !== FREE_PLAN_ID && <span className="text-gray-400 text-lg">one-time</span>}
                                </div>

                                {plan.id === FREE_PLAN_ID ? (
                                    <p className="text-sm text-gray-400">No payment required</p>
                                ) : (
                                    <p className="text-sm text-gray-400">No subscription · no auto-renewal</p>
                                )}
                            </div>

                            {/* Divider */}
                            <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mb-6"></div>

                            {/* Features */}
                            <ul className="space-y-4 mb-8">
                                {plan.features.map((feature, index) => (
                                    <li key={index} className="flex items-start gap-3">
                                        <CheckIcon className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                                        <span className="text-gray-300 text-sm leading-relaxed">{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            {/* Purchase Button */}
                            <button
                                onClick={() => handlePurchase(plan.id)}
                                disabled={loading === plan.id}
                                className={`w-full py-3.5 px-6 rounded-xl font-semibold transition-all duration-200 ${plan.popular
                                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/30'
                                    : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {loading === plan.id ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing...
                                    </span>
                                ) : plan.id === FREE_PLAN_ID ? (
                                    user ? 'Start creating' : 'Get started free'
                                ) : (
                                    'Buy credits'
                                )}
                            </button>
                        </div>
                    ))}
                </div>

                {/* Purchase terms shown before checkout */}
                <p className="mt-12 text-center text-sm text-gray-400 max-w-3xl mx-auto leading-relaxed">
                    Prices are in Indian Rupees (INR); the amount shown in the Razorpay checkout is the total you pay. Credit packs are
                    one-time purchases with no subscription or automatic renewal, delivered to your account as credits (see our{' '}
                    <PolicyLink to="shipping" />), and payments are processed by Razorpay. By purchasing,
                    you agree to our <PolicyLink to="terms" /> and <PolicyLink to="refund" />. See our <PolicyLink to="privacy" />, or{' '}
                    <PolicyLink to="contact">contact support</PolicyLink> with any questions.
                </p>
            </div>
        </section>
    );
}
