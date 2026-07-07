const axios = require('axios');
const config = require('../../../config');
const encryption = require('../../../utils/encryption');
const GitHubConnection = require('../models/GitHubConnection');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class GitHubAuthService {
  constructor() {
    this.clientId = config.GITHUB_CLIENT_ID;
    this.clientSecret = config.GITHUB_CLIENT_SECRET;
    this.callbackUrl = config.GITHUB_CALLBACK_URL;
    this.baseUrl = 'https://github.com';
    this.apiUrl = 'https://api.github.com';
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
    const scope = 'repo,read:user,user:email,admin:repo_hook,admin:org,workflow';

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope,
      state: JSON.stringify({ userId, organizationId, token: state })
    });

    return `${this.baseUrl}/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code
   * @returns {Object} Token data
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/login/oauth/access_token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: this.callbackUrl
        },
        {
          headers: {
            Accept: 'application/json'
          }
        }
      );

      if (response.data.error) {
        throw new AppError(
          `GitHub OAuth error: ${response.data.error_description || response.data.error}`,
          400
        );
      }

      return {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type,
        scope: response.data.scope
      };
    } catch (error) {
      logger.error('GitHub token exchange failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to exchange code for token',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get GitHub user information
   * @param {string} accessToken - GitHub access token
   * @returns {Object} User data
   */
  async getUserInfo(accessToken) {
    try {
      const [userResponse, emailsResponse] = await Promise.all([
        axios.get(`${this.apiUrl}/user`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }),
        axios.get(`${this.apiUrl}/user/emails`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        })
      ]);

      const user = userResponse.data;
      const primaryEmail = emailsResponse.data.find(email => email.primary)?.email || user.email;

      return {
        githubUserId: String(user.id),
        githubUsername: user.login,
        githubEmail: primaryEmail,
        githubAvatarUrl: user.avatar_url
      };
    } catch (error) {
      logger.error('Failed to fetch GitHub user info:', error);
      throw new AppError(
        'Failed to fetch GitHub user information',
        error.response?.status || 500
      );
    }
  }

  /**
   * Connect GitHub account for a user and organization
   * @param {Object} params - Connection parameters
   * @param {string} params.code - OAuth authorization code
   * @param {string} params.userId - User ID
   * @param {string} params.organizationId - Organization ID
   * @returns {Object} Connection data
   */
  async connectAccount({ code, userId, organizationId }) {
    try {
      // Exchange code for token
      const tokenData = await this.exchangeCodeForToken(code);

      // Get user info
      const userInfo = await this.getUserInfo(tokenData.accessToken);

      // Encrypt the access token
      const encryptedAccessToken = encryption.encrypt(tokenData.accessToken);

      // Check if connection already exists
      let connection = await GitHubConnection.findOne({
        organizationId,
        githubUserId: userInfo.githubUserId
      });

      if (connection) {
        // Update existing connection
        connection.userId = userId;
        connection.githubUsername = userInfo.githubUsername;
        connection.githubEmail = userInfo.githubEmail;
        connection.githubAvatarUrl = userInfo.githubAvatarUrl;
        connection.accessToken = encryptedAccessToken;
        connection.tokenType = tokenData.tokenType;
        connection.scope = tokenData.scope;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();
      } else {
        // Create new connection
        connection = new GitHubConnection({
          userId,
          organizationId,
          githubUserId: userInfo.githubUserId,
          githubUsername: userInfo.githubUsername,
          githubEmail: userInfo.githubEmail,
          githubAvatarUrl: userInfo.githubAvatarUrl,
          accessToken: encryptedAccessToken,
          tokenType: tokenData.tokenType,
          scope: tokenData.scope,
          status: 'active',
          lastSyncedAt: new Date()
        });
      }

      await connection.save();

      logger.info(`GitHub account connected for user ${userId} in organization ${organizationId}`);

      return {
        id: connection._id,
        githubUsername: connection.githubUsername,
        githubEmail: connection.githubEmail,
        githubAvatarUrl: connection.githubAvatarUrl,
        status: connection.status,
        createdAt: connection.createdAt
      };
    } catch (error) {
      logger.error('GitHub account connection failed:', error);
      throw error;
    }
  }

  /**
   * Disconnect GitHub account
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   */
  async disconnectAccount(userId, organizationId) {
    try {
      const connection = await GitHubConnection.findOneAndDelete({
        userId,
        organizationId
      });

      if (!connection) {
        throw new AppError('GitHub connection not found', 404);
      }

      logger.info(`GitHub account disconnected for user ${userId} in organization ${organizationId}`);

      return { message: 'GitHub account disconnected successfully' };
    } catch (error) {
      logger.error('GitHub account disconnection failed:', error);
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
    const connection = await GitHubConnection.findOne({
      userId,
      organizationId
    });

    if (!connection) {
      return { connected: false };
    }

    return {
      connected: true,
      githubUsername: connection.githubUsername,
      githubEmail: connection.githubEmail,
      githubAvatarUrl: connection.githubAvatarUrl,
      status: connection.status,
      lastSyncedAt: connection.lastSyncedAt,
      repositoryCount: connection.repositories.length
    };
  }

  /**
   * Get decrypted access token for API calls
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {string} Decrypted access token
   */
  async getAccessToken(userId, organizationId) {
    const connection = await GitHubConnection.findOne({
      userId,
      organizationId
    }).select('+accessToken');

    if (!connection) {
      throw new AppError('GitHub connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('GitHub connection is not active', 403);
    }

    return encryption.decrypt(connection.accessToken);
  }
}

module.exports = new GitHubAuthService();
