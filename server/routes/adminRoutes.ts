import express from 'express';
import rateLimit from 'express-rate-limit';
import { adminMiddleware, authMiddleware } from '../middlewares/adminAuth.js';
import { aiMonitoring, analytics, creditTransactions, credits, currentAdmin, dashboard, deleteGeneration, deleteUser, generation, generations, health, logs, profile, settings, updateCredits, updateProfile, updateSettings, updateUser, user, users } from '../controllers/adminController.js';
import { createModel, deleteModel, listAdminModels, updateModel } from '../controllers/modelLibraryController.js';
import { acceptUploads, MODEL_LIBRARY_IMAGE_MAX_BYTES, modelLibraryUpload } from '../configs/multer.js';

const adminRouter = express.Router();
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many admin requests' } });

adminRouter.use(adminLimiter, authMiddleware, adminMiddleware);
adminRouter.get('/me', currentAdmin);
adminRouter.get('/dashboard', dashboard);
adminRouter.get('/users', users);
adminRouter.get('/users/:id', user);
adminRouter.patch('/users/:id', updateUser);
adminRouter.delete('/users/:id', deleteUser);
adminRouter.patch('/users/:id/credits', updateCredits);
adminRouter.get('/generations', generations);
adminRouter.get('/generations/:id', generation);
adminRouter.delete('/generations/:id', deleteGeneration);
adminRouter.get('/credits', credits);
adminRouter.get('/credits/transactions', creditTransactions);
adminRouter.get('/analytics', analytics);
adminRouter.get('/ai-monitoring', aiMonitoring);
adminRouter.get('/logs', logs);
adminRouter.get('/settings', settings);
adminRouter.patch('/settings', updateSettings);
adminRouter.get('/profile', profile);
adminRouter.patch('/profile', updateProfile);
adminRouter.get('/model-library', listAdminModels);
adminRouter.post('/model-library', acceptUploads(modelLibraryUpload.single('image'), MODEL_LIBRARY_IMAGE_MAX_BYTES), createModel);
adminRouter.patch('/model-library/:id', acceptUploads(modelLibraryUpload.single('image'), MODEL_LIBRARY_IMAGE_MAX_BYTES), updateModel);
adminRouter.delete('/model-library/:id', deleteModel);
adminRouter.get('/health', health);

export default adminRouter;