const crypto = require('crypto');
const config = require('../config');

class EncryptionService {
  constructor() {
    if (!config.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY is required but not set in environment variables');
    }

    // Verify the encryption key is 64 hex characters (32 bytes for AES-256)
    if (!/^[0-9a-fA-F]{64}$/.test(config.ENCRYPTION_KEY)) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes)');
    }

    this.algorithm = 'aes-256-gcm';
    this.key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
    this.ivLength = 16; // AES block size
    this.authTagLength = 16; // GCM auth tag length
  }

  /**
   * Encrypt a string using AES-256-GCM
   * @param {string} text - Plain text to encrypt
   * @returns {string} Encrypted data in format: iv:authTag:encrypted
   */
  encrypt(text) {
    if (!text) {
      return null;
    }

    try {
      // Generate a random IV for each encryption
      const iv = crypto.randomBytes(this.ivLength);

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      // Encrypt the text
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get the auth tag
      const authTag = cipher.getAuthTag();

      // Return format: iv:authTag:encrypted (all hex encoded)
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt a string that was encrypted with AES-256-GCM
   * @param {string} encryptedData - Encrypted data in format: iv:authTag:encrypted
   * @returns {string} Decrypted plain text
   */
  decrypt(encryptedData) {
    if (!encryptedData) {
      return null;
    }

    try {
      // Split the encrypted data
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const [ivHex, authTagHex, encrypted] = parts;

      // Convert from hex
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      // Decrypt the text
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Generate a random encryption key (for setup purposes)
   * @returns {string} 64-character hex string (32 bytes)
   */
  static generateKey() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = new EncryptionService();
