const mongoose = require('mongoose');
const logger = require('./logger');

class Database {
  constructor() {
    this.connection = null;
    this.connected = false;
  }

  isConnected() {
    return this.connected && mongoose.connection.readyState === 1;
  }

  async connect(maxRetries = 5, baseDelay = 2000) {
    const uri = process.env.NODE_ENV === 'test'
      ? process.env.MONGODB_TEST_URI
      : process.env.MONGODB_URI;

    if (!uri) {
      logger.warn('MongoDB URI is not defined - service will run without database');
      return null;
    }

    const options = {
      maxPoolSize: 10,
      minPoolSize: 2,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      family: 4,
      autoIndex: true,
      autoCreate: true
    };

    // Suppress duplicate index warnings
    mongoose.set('strictQuery', false);

    // Exponential backoff retry logic
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`MongoDB connection attempt ${attempt}/${maxRetries}`);

        this.connection = await mongoose.connect(uri, options);
        this.connected = true;

        logger.info(`MongoDB connected: ${this.connection.connection.host}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
          logger.error('MongoDB connection error:', err);
          this.connected = false;
        });

        mongoose.connection.on('disconnected', () => {
          logger.warn('MongoDB disconnected');
          this.connected = false;
        });

        mongoose.connection.on('reconnected', () => {
          logger.info('MongoDB reconnected');
          this.connected = true;
        });

        return this.connection;
      } catch (error) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.error(`MongoDB connection attempt ${attempt}/${maxRetries} failed:`, error.message);

        if (attempt < maxRetries) {
          logger.info(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error('MongoDB connection failed after maximum retries - service will run without database');
          this.connected = false;
          return null;
        }
      }
    }
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.connection.close();
        logger.info('MongoDB disconnected gracefully');
      }
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
      throw error;
    }
  }

  async dropDatabase() {
    try {
      if (process.env.NODE_ENV === 'test') {
        await mongoose.connection.dropDatabase();
        logger.info('Test database dropped');
      } else {
        throw new Error('Cannot drop database in non-test environment');
      }
    } catch (error) {
      logger.error('Error dropping database:', error);
      throw error;
    }
  }
}

module.exports = new Database();
