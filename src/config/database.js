const mongoose = require('mongoose');
const logger = require('./logger');

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      const uri = process.env.NODE_ENV === 'test'
        ? process.env.MONGODB_TEST_URI
        : process.env.MONGODB_URI;

      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      const options = {
        maxPoolSize: 10,
        minPoolSize: 2,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 5000,
        family: 4
      };

      this.connection = await mongoose.connect(uri, options);

      logger.info(`MongoDB connected: ${this.connection.connection.host}`);

      // Handle connection events
      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });

      return this.connection;
    } catch (error) {
      logger.error('MongoDB connection failed:', error);
      throw error;
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
