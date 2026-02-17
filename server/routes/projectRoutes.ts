import express from 'express';
import { createProject, createProjectBundle, createVideo, deleteProject, getAllPublishedProjects } from '../controllers/projectController.js';
import { protect } from '../middlewares/auth.js';
import upload from '../configs/multer.js';
import logger from '../configs/logger.js';

const projectRouter = express.Router()

// Log route registration
logger.info('[projectRoutes] Registering project routes');

projectRouter.post('/create', upload.array('images', 2), protect, createProject)
projectRouter.post('/create-bundle', upload.array('images', 2), protect, createProjectBundle)
projectRouter.post('/video', protect, createVideo)
projectRouter.get('/published', getAllPublishedProjects)
projectRouter.delete('/:projectId', protect, deleteProject)

logger.info('[projectRoutes] Project routes registered successfully');

export default projectRouter