const axios = require('axios');
const config = require('../../../config');
const encryption = require('../../../utils/encryption');
const VercelConnection = require('../models/VercelConnection');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class VercelAuthService {
  constructor() {
    this.clientId = config.VERCEL_CLIENT_ID;
    this.clientSecret = config.VERCEL_CLIENT_SECRET;
    this.callbackUrl = config.VERCEL_CALLBACK_URL;
    this.baseUrl = 'https://vercel.com';
    this.apiUrl = 'https://api.vercel.com';
  }

  /**
   * Check if Vercel integration is available (credentials configured)
   * @returns {boolean}
   */
  isAvailable() {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * Generate OAuth authorization URL
   * @param {Object} params - Authorization parameters
   * @param {string} params.userId - User ID
   * @param {string} params.organizationId - Organization ID
   * @param {string} params.state - CSRF state token
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl({ userId, organizationId, state }) {
    if (!this.isAvailable()) {
      throw new AppError('Vercel integration is not yet available', 503);
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      state: JSON.stringify({ userId, organizationId, token: state })
    });

    return `${this.baseUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code
   * @returns {Object} Token data
   */
  async exchangeCodeForToken(code) {
    if (!this.isAvailable()) {
      throw new AppError('Vercel integration is not yet available', 503);
    }

    try {
      const response = await axios.post(
        `${this.apiUrl}/v2/oauth/access_token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: this.callbackUrl
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.data.error) {
        throw new AppError(
          `Vercel OAuth error: ${response.data.error_description || response.data.error}`,
          400
        );
      }

      return {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type || 'Bearer',
        teamId: response.data.team_id || null,
        userId: response.data.user_id,
        installationType: response.data.installation_id ? 'team' : 'user'
      };
    } catch (error) {
      logger.error('Vercel token exchange failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to exchange code for token',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get Vercel user information
   * @param {string} accessToken - Vercel access token
   * @returns {Object} User data
   */
  async getUserInfo(accessToken) {
    try {
      const response = await axios.get(`${this.apiUrl}/v2/user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      const user = response.data.user;

      return {
        vercelUserId: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      };
    } catch (error) {
      logger.error('Failed to fetch Vercel user info:', error);
      throw new AppError(
        'Failed to fetch Vercel user information',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get Vercel team information (if applicable)
   * @param {string} accessToken - Vercel access token
   * @param {string} teamId - Team ID
   * @returns {Object|null} Team data or null
   */
  async getTeamInfo(accessToken, teamId) {
    if (!teamId) {
      return null;
    }

    try {
      const response = await axios.get(`${this.apiUrl}/v2/teams/${teamId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      return {
        teamId: response.data.id,
        teamSlug: response.data.slug,
        teamName: response.data.name,
        teamAvatar: response.data.avatar
      };
    } catch (error) {
      logger.warn(`Failed to fetch Vercel team info for ${teamId}:`, error.message);
      // Don't fail if team info can't be fetched
      return null;
    }
  }

  /**
   * Connect Vercel account for a user and organization
   * @param {Object} params - Connection parameters
   * @param {string} params.code - OAuth authorization code
   * @param {string} params.userId - User ID
   * @param {string} params.organizationId - Organization ID
   * @returns {Object} Connection data
   */
  async connectAccount({ code, userId, organizationId }) {
    if (!this.isAvailable()) {
      throw new AppError('Vercel integration is not yet available', 503);
    }

    try {
      // Exchange code for token
      const tokenData = await this.exchangeCodeForToken(code);

      // Get user info
      const userInfo = await this.getUserInfo(tokenData.accessToken);

      // Get team info if team_id is present
      let teamInfo = null;
      if (tokenData.teamId) {
        teamInfo = await this.getTeamInfo(tokenData.accessToken, tokenData.teamId);
      }

      // Encrypt the access token
      const encryptedAccessToken = encryption.encrypt(tokenData.accessToken);

      // Check if connection already exists
      let connection = await VercelConnection.findOne({
        organizationId,
        vercelUserId: userInfo.vercelUserId
      });

      if (connection) {
        // Update existing connection
        connection.userId = userId;
        connection.username = userInfo.username;
        connection.email = userInfo.email;
        connection.name = userInfo.name;
        connection.avatar = userInfo.avatar;
        connection.accessToken = encryptedAccessToken;
        connection.tokenType = tokenData.tokenType;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();

        // Update team info if present
        if (teamInfo) {
          connection.teamId = teamInfo.teamId;
          connection.teamSlug = teamInfo.teamSlug;
          connection.teamName = teamInfo.teamName;
          connection.teamAvatar = teamInfo.teamAvatar;
        }
      } else {
        // Create new connection
        const connectionData = {
          userId,
          organizationId,
          vercelUserId: userInfo.vercelUserId,
          username: userInfo.username,
          email: userInfo.email,
          name: userInfo.name,
          avatar: userInfo.avatar,
          accessToken: encryptedAccessToken,
          tokenType: tokenData.tokenType,
          status: 'active',
          lastSyncedAt: new Date()
        };

        // Add team info if present
        if (teamInfo) {
          connectionData.teamId = teamInfo.teamId;
          connectionData.teamSlug = teamInfo.teamSlug;
          connectionData.teamName = teamInfo.teamName;
          connectionData.teamAvatar = teamInfo.teamAvatar;
        }

        connection = new VercelConnection(connectionData);
      }

      await connection.save();

      logger.info(`Vercel account connected for user ${userId} in organization ${organizationId}`);

      return {
        id: connection._id,
        vercelUserId: connection.vercelUserId,
        username: connection.username,
        email: connection.email,
        name: connection.name,
        avatar: connection.avatar,
        teamId: connection.teamId,
        teamSlug: connection.teamSlug,
        teamName: connection.teamName,
        status: connection.status,
        createdAt: connection.createdAt
      };
    } catch (error) {
      logger.error('Vercel account connection failed:', error);
      throw error;
    }
  }

  /**
   * Disconnect Vercel account
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   */
  async disconnectAccount(userId, organizationId) {
    try {
      const connection = await VercelConnection.findOneAndDelete({
        userId,
        organizationId
      });

      if (!connection) {
        throw new AppError('Vercel connection not found', 404);
      }

      logger.info(`Vercel account disconnected for user ${userId} in organization ${organizationId}`);

      return { message: 'Vercel account disconnected successfully' };
    } catch (error) {
      logger.error('Vercel account disconnection failed:', error);
      throw error;
    }
  }

  /**
   * Get connection status
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {Object} Connection status
   */
  async getConnectionStatus(userId, organizationId) {
    if (!this.isAvailable()) {
      return {
        available: false,
        status: 'coming_soon',
        message: 'Vercel integration coming soon'
      };
    }

    const connection = await VercelConnection.findOne({
      userId,
      organizationId
    });

    if (!connection) {
      return {
        available: true,
        connected: false
      };
    }

    return {
      available: true,
      connected: true,
      vercelUserId: connection.vercelUserId,
      username: connection.username,
      email: connection.email,
      name: connection.name,
      avatar: connection.avatar,
      teamId: connection.teamId,
      teamSlug: connection.teamSlug,
      teamName: connection.teamName,
      status: connection.status,
      lastSyncedAt: connection.lastSyncedAt,
      projectCount: connection.projects.length,
      monitoredProjectCount: connection.monitoredProjects?.length || 0
    };
  }

  /**
   * Get decrypted access token for API calls
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {string} Decrypted access token
   */
  async getAccessToken(userId, organizationId) {
    const connection = await VercelConnection.findOne({
      userId,
      organizationId
    }).select('+accessToken');

    if (!connection) {
      throw new AppError('Vercel connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('Vercel connection is not active', 403);
    }

    return encryption.decrypt(connection.accessToken);
  }

  /**
   * Get connection by ID
   * @param {string} connectionId - Connection ID
   * @returns {Object} Connection
   */
  async getConnectionById(connectionId) {
    const connection = await VercelConnection.findById(connectionId).select('+accessToken');

    if (!connection) {
      throw new AppError('Vercel connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('Vercel connection is not active', 403);
    }

    return connection;
  }
}

module.exports = new VercelAuthService();
