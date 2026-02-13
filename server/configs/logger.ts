import winston from 'winston';
import path from 'path';

// Define log format with timestamp and metadata
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
    winston.format.json()
);

// Console format for development (more readable)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, metadata }) => {
        const meta = Object.keys(metadata || {}).length ? JSON.stringify(metadata) : '';
        return `${timestamp} [${level}]: ${message} ${meta}`;
    })
);

// Create the Winston logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // Write all logs to combined.log
        new winston.transports.File({
            filename: path.join('logs', 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Write error logs to error.log
        new winston.transports.File({
            filename: path.join('logs', 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

// Add console transport for non-production environments
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat,
    }));
}

// Utility function to mask sensitive data in logs
export const maskSensitive = (data: any): any => {
    if (!data || typeof data !== 'object') return data;

    const masked = { ...data };
    const sensitiveKeys = [
        'password', 'token', 'apiKey', 'api_key', 'secret',
        'authorization', 'cookie', 'creditCard', 'ssn',
        'CLERK_SECRET_KEY', 'CLOUDINARY_API_SECRET', 'GOOGLE_API_KEY'
    ];

    for (const key in masked) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
            masked[key] = '***MASKED***';
        } else if (typeof masked[key] === 'object' && masked[key] !== null) {
            masked[key] = maskSensitive(masked[key]);
        }
    }

    return masked;
};

// Helper to create child logger with context
export const createContextLogger = (context: Record<string, any>) => {
    return logger.child(context);
};

export default logger;
