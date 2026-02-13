import express from 'express';
import { getAllProjects, getProjectById, getUserCredits, toggleProjectPublic } from '../controllers/userController.js';
import { protect } from '../middlewares/auth.js';
import logger from '../configs/logger.js';


const userRouter = express.Router();

// Log route registration
logger.info('[userRoutes] Registering user routes');

userRouter.get('/credits', protect, getUserCredits)
userRouter.get('/projects', protect, getAllProjects)
userRouter.get('/projects/:projectId', protect, getProjectById)
userRouter.get('/publish/:projectId', protect, toggleProjectPublic)

logger.info('[userRoutes] User routes registered successfully');

export default userRouter;