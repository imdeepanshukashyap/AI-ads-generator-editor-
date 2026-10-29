import express from 'express';
import { getPublishedModel, listPublishedModels } from '../controllers/modelLibraryController.js';

const modelLibraryRouter = express.Router();

modelLibraryRouter.get('/', listPublishedModels);
modelLibraryRouter.get('/:id', getPublishedModel);

export default modelLibraryRouter;
