import express from 'express';
import { 
    getConnectedAccounts, 
    disconnectAccount, 
    getYoutubeAuthUrl, 
    handleYoutubeCallback,
    getMetaAuthUrl,
    handleMetaCallback,
    selectMetaAccounts,
    generateCaption,
    createSocialPost,
    getSocialPosts,
    retrySocialPost,
} from '../controllers/socialController.js';
import { protect } from '../middlewares/auth.js';
import { 
    socialGeneralLimiter, 
    socialCaptionLimiter, 
    socialPublishLimiter, 
    socialAuthLimiter 
} from '../middlewares/rateLimiter.js';
import logger from '../configs/logger.js';

const socialRouter = express.Router();

logger.info('[socialRoutes] Registering social routes with rate limiting');

// Apply general limiter to all social routes
socialRouter.use(socialGeneralLimiter);

// Protected account management
socialRouter.get('/accounts', protect, getConnectedAccounts);
socialRouter.delete('/accounts/:id', protect, disconnectAccount);

// YouTube OAuth flow
socialRouter.get('/connect/youtube', socialAuthLimiter, protect, getYoutubeAuthUrl);
socialRouter.get('/callback/youtube', handleYoutubeCallback); // Public browser redirect from Google

// Meta (Facebook & Instagram) OAuth flow
socialRouter.get('/connect/meta', socialAuthLimiter, protect, getMetaAuthUrl);
socialRouter.get('/callback/meta', handleMetaCallback); // Public browser redirect from Meta
socialRouter.post('/meta/select', protect, selectMetaAccounts);

// AI Caption Generation
socialRouter.post('/caption', socialCaptionLimiter, protect, generateCaption);

// Publishing & Scheduling
socialRouter.post('/post', socialPublishLimiter, protect, createSocialPost);
socialRouter.get('/posts', protect, getSocialPosts);
socialRouter.post('/posts/:id/retry', socialPublishLimiter, protect, retrySocialPost);

logger.info('[socialRoutes] Social routes registered successfully');

export default socialRouter;
