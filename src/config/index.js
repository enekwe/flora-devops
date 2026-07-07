require('dotenv').config();

module.exports = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 4003,
  SERVICE_NAME: process.env.SERVICE_NAME || 'flora-devops',

  // Database
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_TEST_URI: process.env.MONGODB_TEST_URI,

  // Encryption
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,

  // GitHub
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL,
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,

  // Vercel (Coming Soon)
  VERCEL_CLIENT_ID: process.env.VERCEL_CLIENT_ID,
  VERCEL_CLIENT_SECRET: process.env.VERCEL_CLIENT_SECRET,
  VERCEL_CALLBACK_URL: process.env.VERCEL_CALLBACK_URL,

  // Railway (Coming Soon)
  RAILWAY_CLIENT_ID: process.env.RAILWAY_CLIENT_ID,
  RAILWAY_CLIENT_SECRET: process.env.RAILWAY_CLIENT_SECRET,
  RAILWAY_CALLBACK_URL: process.env.RAILWAY_CALLBACK_URL,

  // CORS
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'],

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
