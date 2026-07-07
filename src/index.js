const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const database = require('./config/database');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Import routes
const githubRoutes = require('./integrations/github/routes');
const gitlabRoutes = require('./integrations/gitlab/routes');
const linearRoutes = require('./integrations/linear/routes');
const deploymentRoutes = require('./integrations/deployment/routes');
const webhookRoutes = require('./webhooks/routes');

// Initialize Express app
const app = express();

// Trust proxy for rate limiting and security
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: config.ALLOWED_ORIGINS,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: config.SERVICE_NAME,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    service: config.SERVICE_NAME,
    version: '1.0.0',
    description: 'Flora DevOps microservice for developer tools and version control integrations',
    integrations: {
      github: '/api/integrations/github',
      gitlab: '/api/integrations/gitlab',
      linear: '/api/integrations/linear',
      vercel: '/api/integrations/vercel',
      netlify: '/api/integrations/netlify'
    },
    webhooks: '/api/webhooks',
    documentation: 'https://github.com/enekwe/flora-devops'
  });
});

// Mount integration routes
app.use('/api/integrations/github', githubRoutes);
app.use('/api/integrations/gitlab', gitlabRoutes);
app.use('/api/integrations/linear', linearRoutes);
app.use('/api/integrations', deploymentRoutes); // Handles /vercel and /netlify

// Mount webhook routes
app.use('/api/webhooks', webhookRoutes);

// 404 handler
app.use(notFound);

// Error handling middleware
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await database.connect();

    // Start listening
    const PORT = config.PORT || 4003;
    app.listen(PORT, () => {
      logger.info(`${config.SERVICE_NAME} microservice running on port ${PORT}`);
      logger.info(`Environment: ${config.NODE_ENV}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  try {
    await database.disconnect();
    logger.info('Database connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
startServer();

module.exports = app;
