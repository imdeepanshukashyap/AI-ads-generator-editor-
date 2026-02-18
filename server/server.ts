import "./configs/instrument.mjs"
import express, { Request, Response } from 'express';
import cors from 'cors'
import 'dotenv/config'
import { clerkMiddleware } from '@clerk/express'
import clerkWebhooks from './controllers/clerk.js';
import * as Sentry from "@sentry/node"
import userRouter from "./routes/userRoutes.js";
import projectRouter from "./routes/projectRoutes.js";
import paymentRouter from "./routes/paymentRoutes.js";
import logger from './configs/logger.js';
import { requestLogger, errorLogger } from './middlewares/requestLogger.js';


const app = express();

const PORT = Number(process.env.PORT) || 5001;

// Log server startup configuration
logger.info('Starting UGC Project Server', {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: PORT,
  logLevel: process.env.LOG_LEVEL || 'info',
});

// Middleware - CORS
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}))
logger.info('CORS middleware registered');

// Clerk webhook endpoint (must be before express.json to handle raw body)
app.post('/api/clerk', express.raw({ type: 'application/json' }), clerkWebhooks)
logger.info('Clerk webhook endpoint registered at /api/clerk');

// Middleware - JSON parsing and Clerk authentication
app.use(express.json())
app.use(clerkMiddleware())
logger.info('JSON parser and Clerk middleware registered');

// Request logging middleware (after auth so we can capture userId)
app.use(requestLogger);
logger.info('Request logging middleware registered');

// Health check endpoint
app.get('/', (req: Request, res: Response) => {
  logger.debug('Health check endpoint accessed');
  res.send('Server is Live!');
});

// Sentry debug endpoint
app.get("/debug-sentry", function mainHandler(req, res) {
  logger.warn('Sentry debug endpoint triggered - throwing test error');
  throw new Error("My first Sentry error!");
});

// API Routes
app.use('/api/user', userRouter)
logger.info('User routes registered at /api/user');

app.use('/api/project', projectRouter)
logger.info('Project routes registered at /api/project');

app.use('/api/payment', paymentRouter)
logger.info('Payment routes registered at /api/payment');

// Error logging middleware (before Sentry error handler)
app.use(errorLogger);

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);
logger.info('Sentry error handler registered');

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server started successfully`, {
    port: PORT,
    url: `http://0.0.0.0:${PORT}`,
    timeout: '300000ms (5 minutes)',
  });
  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});

// Set server timeout (5 minutes for long-running AI operations)
server.setTimeout(300000);
logger.info('Server timeout configured', { timeout: '300000ms' });

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received - starting graceful shutdown');
  server.close(() => {
    logger.info('Server closed - all connections terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received - starting graceful shutdown');
  server.close(() => {
    logger.info('Server closed - all connections terminated');
    process.exit(0);
  });
});

// Log unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason,
    promise: promise,
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
  });
  // Exit process after logging
  process.exit(1);
});