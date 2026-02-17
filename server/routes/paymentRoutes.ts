import { Router } from 'express';
import { createOrder, verifyPayment } from '../controllers/paymentController.js';
import { protect } from '../middlewares/auth.js';
import logger from '../configs/logger.js';

const router = Router();

logger.info('[paymentRoutes] Registering payment routes');

// Create Razorpay order (requires authentication)
router.post('/create-order', protect, createOrder);

// Verify payment (requires authentication)
router.post('/verify', protect, verifyPayment);

logger.info('[paymentRoutes] Payment routes registered successfully');

export default router;
