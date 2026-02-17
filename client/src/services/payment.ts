import api from '../configs/axios';

export interface CreateOrderResponse {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
}

export interface VerifyPaymentRequest {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
}

export interface VerifyPaymentResponse {
    message: string;
    credits: number;
}

/**
 * Create Razorpay order for a plan
 */
export const createOrder = async (planId: string, token: string): Promise<CreateOrderResponse> => {
    const { data } = await api.post('/api/payment/create-order', { planId }, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return data;
};

/**
 * Verify Razorpay payment
 */
export const verifyPayment = async (paymentData: VerifyPaymentRequest, token: string): Promise<VerifyPaymentResponse> => {
    const { data } = await api.post('/api/payment/verify', paymentData, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return data;
};
