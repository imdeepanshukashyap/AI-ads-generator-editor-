import { useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { CheckIcon } from 'lucide-react';
import { plansData } from '../assets/dummy-data';
import { createOrder, verifyPayment } from '../services/payment';
import toast from 'react-hot-toast';

declare global {
    interface Window {
        Razorpay: any;
    }
}

export default function Pricing() {
    const { user } = useUser();
    const { getToken } = useAuth();
    const [loading, setLoading] = useState<string | null>(null);

    const handlePurchase = async (planId: string) => {
        if (!user) {
            toast.error('Please sign in to purchase a plan');
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

            // Create order on backend
            const orderData = await createOrder(planId, token);

            // Razorpay checkout options
            const options = {
                key: import.meta.env.VITE_RAZORPAY_KEY_ID,
                amount: orderData.amount,
                currency: orderData.currency,
                name: 'AdGen Studio',
                description: `Purchase ${plansData.find(p => p.id === planId)?.name} Plan`,
                order_id: orderData.orderId,
                handler: async function (response: any) {
                    try {
                        // Get fresh Clerk token for verification
                        const verificationToken = await getToken();
                        if (!verificationToken) {
                            toast.error('Authentication failed. Please sign in again.');
                            setLoading(null);
                            return;
                        }

                        // Verify payment on backend
                        const result = await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        }, verificationToken);

                        toast.success(`Payment successful! ${result.credits} credits added to your account.`);

                        // Reload page to update credits
                        setTimeout(() => {
                            window.location.reload();
                        }, 1500);
                    } catch (error: any) {
                        console.error('Payment verification failed:', error);
                        toast.error(error?.response?.data?.message || 'Payment verification failed');
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

            const razorpay = new window.Razorpay(options);
            razorpay.open();

        } catch (error: any) {
            console.error('Order creation failed:', error);
            toast.error(error?.response?.data?.message || 'Failed to create order');
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
                                    {plan.id !== 'starter' && <span className="text-gray-400 text-lg">/month</span>}
                                </div>

                                {plan.id === 'starter' ? (
                                    <p className="text-sm text-gray-400">Always free</p>
                                ) : (
                                    <p className="text-sm text-gray-400">Only billed monthly</p>
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

                            {/* Subscribe Button */}
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
                                ) : (
                                    'Subscribe'
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}