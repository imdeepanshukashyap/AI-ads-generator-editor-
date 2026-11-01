import express from 'express';
import { createProject, createProjectBundle, createVideo, deleteProject, getAllPublishedProjects, resetGeneration } from '../controllers/projectController.js';
import { protect } from '../middlewares/auth.js';
import upload, { acceptUploads, PROJECT_IMAGE_MAX_BYTES, withUploadCleanup } from '../configs/multer.js';
import logger from '../configs/logger.js';

const projectRouter = express.Router()

// Log route registration
logger.info('[projectRoutes] Registering project routes');

// protect runs before upload so signed-out, suspended or deleted accounts are refused before any file is written to disk;
// withUploadCleanup deletes the temporary files however the request ends
projectRouter.post('/create', protect, acceptUploads(upload.array('images', 2), PROJECT_IMAGE_MAX_BYTES), withUploadCleanup(createProject))
projectRouter.post('/create-bundle', protect, acceptUploads(upload.array('images', 2), PROJECT_IMAGE_MAX_BYTES), withUploadCleanup(createProjectBundle))
projectRouter.post('/video', protect, createVideo)
projectRouter.get('/published', getAllPublishedProjects)
projectRouter.delete('/:projectId', protect, deleteProject)
projectRouter.post('/reset-generation', protect, resetGeneration)

logger.info('[projectRoutes] Project routes registered successfully');

export default projectRouter