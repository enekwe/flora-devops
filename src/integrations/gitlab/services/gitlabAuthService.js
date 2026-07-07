const axios = require('axios');
const config = require('../../../config');
const encryption = require('../../../utils/encryption');
const GitLabConnection = require('../models/GitLabConnection');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class GitLabAuthService {
  constructor() {
    this.clientId = config.GITLAB_CLIENT_ID;
    this.clientSecret = config.GITLAB_CLIENT_SECRET;
    this.callbackUrl = config.GITLAB_CALLBACK_URL;
    this.instanceUrl = config.GITLAB_INSTANCE_URL;
  }

  /**
   * Generate OAuth authorization URL
   * @param {Object} params - Authorization parameters
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl({ userId, organizationId, state }) {
    const scope = 'api read_user read_repository write_repository';

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope,
      state: JSON.stringify({ userId, organizationId, token: state })
    });

    return `${this.instanceUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code
   * @returns {Object} Token data
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(
        `${this.instanceUrl}/oauth/token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.callbackUrl
        }
      );

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        tokenType: response.data.token_type,
        scope: response.data.scope,
        expiresIn: response.data.expires_in,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('GitLab token exchange failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to exchange code for token',
        error.response?.status || 500
      );
    }
  }

  /**
   * Refresh access token
   * @param {string} refreshToken - Refresh token
   * @returns {Object} New token data
   */
  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post(
        `${this.instanceUrl}/oauth/token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        }
      );

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        tokenType: response.data.token_type,
        scope: response.data.scope,
        expiresIn: response.data.expires_in,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('GitLab token refresh failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to refresh token',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get GitLab user information
   * @param {string} accessToken - GitLab access token
   * @returns {Object} User data
   */
  async getUserInfo(accessToken) {
    try {
      const response = await axios.get(`${this.instanceUrl}/api/v4/user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      const user = response.data;

      return {
        gitlabUserId: String(user.id),
        gitlabUsername: user.username,
        gitlabEmail: user.email,
        gitlabAvatarUrl: user.avatar_url
      };
    } catch (error) {
      logger.error('Failed to fetch GitLab user info:', error);
      throw new AppError(
        'Failed to fetch GitLab user information',
        error.response?.status || 500
      );
    }
  }

  /**
   * Connect GitLab account for a user and organization
   * @param {Object} params - Connection parameters
   * @returns {Object} Connection data
   */
  async connectAccount({ code, userId, organizationId }) {
    try {
      // Exchange code for token
      const tokenData = await this.exchangeCodeForToken(code);

      // Get user info
      const userInfo = await this.getUserInfo(tokenData.accessToken);

      // Encrypt tokens
      const encryptedAccessToken = encryption.encrypt(tokenData.accessToken);
      const encryptedRefreshToken = tokenData.refreshToken
        ? encryption.encrypt(tokenData.refreshToken)
        : null;

      // Calculate expiration date
      const expiresAt = tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000)
        : null;

      // Check if connection already exists
      let connection = await GitLabConnection.findOne({
        organizationId,
        gitlabUserId: userInfo.gitlabUserId
      });

      if (connection) {
        // Update existing connection
        connection.userId = userId;
        connection.gitlabUsername = userInfo.gitlabUsername;
        connection.gitlabEmail = userInfo.gitlabEmail;
        connection.gitlabAvatarUrl = userInfo.gitlabAvatarUrl;
        connection.accessToken = encryptedAccessToken;
        connection.refreshToken = encryptedRefreshToken;
        connection.tokenType = tokenData.tokenType;
        connection.scope = tokenData.scope;
        connection.expiresAt = expiresAt;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();
      } else {
        // Create new connection
        connection = new GitLabConnection({
          userId,
          organizationId,
          gitlabUserId: userInfo.gitlabUserId,
          gitlabUsername: userInfo.gitlabUsername,
          gitlabEmail: userInfo.gitlabEmail,
          gitlabAvatarUrl: userInfo.gitlabAvatarUrl,
          gitlabInstanceUrl: this.instanceUrl,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenType: tokenData.tokenType,
          scope: tokenData.scope,
          expiresAt,
          status: 'active',
          lastSyncedAt: new Date()
        });
      }

      await connection.save();

      logger.info(`GitLab account connected for user ${userId} in organization ${organizationId}`);

      return {
        id: connection._id,
        gitlabUsername: connection.gitlabUsername,
        gitlabEmail: connection.gitlabEmail,
        gitlabAvatarUrl: connection.gitlabAvatarUrl,
        status: connection.status,
        createdAt: connection.createdAt
      };
    } catch (error) {
      logger.error('GitLab account connection failed:', error);
      throw error;
    }
  }

  /**
   * Disconnect GitLab account
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   */
  async disconnectAccount(userId, organizationId) {
    try {
      const connection = await GitLabConnection.findOneAndDelete({
        userId,
        organizationId
      });

      if (!connection) {
        throw new AppError('GitLab connection not found', 404);
      }

      logger.info(`GitLab account disconnected for user ${userId} in organization ${organizationId}`);

      return { message: 'GitLab account disconnected successfully' };
    } catch (error) {
      logger.error('GitLab account disconnection failed:', error);
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
    const connection = await GitLabConnection.findOne({
      userId,
      organizationId
    });

    if (!connection) {
      return { connected: false };
    }

    return {
      connected: true,
      gitlabUsername: connection.gitlabUsername,
      gitlabEmail: connection.gitlabEmail,
      gitlabAvatarUrl: connection.gitlabAvatarUrl,
      gitlabInstanceUrl: connection.gitlabInstanceUrl,
      status: connection.status,
      lastSyncedAt: connection.lastSyncedAt,
      projectCount: connection.projects.length
    };
  }

  /**
   * Get decrypted access token for API calls
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {string} Decrypted access token
   */
  async getAccessToken(userId, organizationId) {
    const connection = await GitLabConnection.findOne({
      userId,
      organizationId
    }).select('+accessToken +refreshToken');

    if (!connection) {
      throw new AppError('GitLab connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('GitLab connection is not active', 403);
    }

    // Check if token is expired and refresh if needed
    if (connection.isTokenExpired() && connection.refreshToken) {
      const refreshToken = encryption.decrypt(connection.refreshToken);
      const tokenData = await this.refreshAccessToken(refreshToken);

      // Update connection with new tokens
      connection.accessToken = encryption.encrypt(tokenData.accessToken);
      connection.refreshToken = tokenData.refreshToken
        ? encryption.encrypt(tokenData.refreshToken)
        : connection.refreshToken;
      connection.expiresAt = tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000)
        : null;
      await connection.save();

      return tokenData.accessToken;
    }

    return encryption.decrypt(connection.accessToken);
  }
}

module.exports = new GitLabAuthService();
