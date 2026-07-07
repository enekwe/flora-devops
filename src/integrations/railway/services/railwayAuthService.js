const axios = require('axios');
const config = require('../../../config');
const encryption = require('../../../utils/encryption');
const RailwayConnection = require('../models/RailwayConnection');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class RailwayAuthService {
  constructor() {
    this.clientId = config.RAILWAY_CLIENT_ID;
    this.clientSecret = config.RAILWAY_CLIENT_SECRET;
    this.callbackUrl = config.RAILWAY_CALLBACK_URL;
    this.oauthUrl = 'https://railway.app/oauth';
    this.tokenUrl = 'https://railway.app/oauth/token';
    this.graphqlUrl = 'https://backboard.railway.app/graphql/v2';
  }

  /**
   * Check if Railway integration is available (credentials configured)
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
      throw new AppError('Railway integration is not yet available', 503);
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      state: JSON.stringify({ userId, organizationId, token: state })
    });

    return `${this.oauthUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code
   * @returns {Object} Token data
   */
  async exchangeCodeForToken(code) {
    if (!this.isAvailable()) {
      throw new AppError('Railway integration is not yet available', 503);
    }

    try {
      const response = await axios.post(
        this.tokenUrl,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: this.callbackUrl,
          grant_type: 'authorization_code'
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.error) {
        throw new AppError(
          `Railway OAuth error: ${response.data.error_description || response.data.error}`,
          400
        );
      }

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        tokenType: response.data.token_type || 'Bearer',
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      logger.error('Railway token exchange failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to exchange code for token',
        error.response?.status || 500
      );
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Object} New token data
   */
  async refreshAccessToken(refreshToken) {
    if (!this.isAvailable()) {
      throw new AppError('Railway integration is not yet available', 503);
    }

    try {
      const response = await axios.post(
        this.tokenUrl,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.error) {
        throw new AppError(
          `Railway token refresh error: ${response.data.error_description || response.data.error}`,
          400
        );
      }

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        tokenType: response.data.token_type || 'Bearer',
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      logger.error('Railway token refresh failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to refresh token',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get Railway user information via GraphQL
   * @param {string} accessToken - Railway access token
   * @returns {Object} User data
   */
  async getUserInfo(accessToken) {
    try {
      const query = `
        query {
          me {
            id
            name
            email
            username
            avatar
          }
        }
      `;

      const response = await axios.post(
        this.graphqlUrl,
        { query },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.errors) {
        throw new AppError(
          `Railway GraphQL error: ${response.data.errors[0].message}`,
          400
        );
      }

      const user = response.data.data.me;

      return {
        railwayUserId: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      };
    } catch (error) {
      logger.error('Failed to fetch Railway user info:', error);
      throw new AppError(
        error.response?.data?.errors?.[0]?.message || 'Failed to fetch Railway user information',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get Railway team information (if applicable)
   * @param {string} accessToken - Railway access token
   * @param {string} teamId - Team ID
   * @returns {Object|null} Team data or null
   */
  async getTeamInfo(accessToken, teamId) {
    if (!teamId) {
      return null;
    }

    try {
      const query = `
        query($teamId: String!) {
          team(id: $teamId) {
            id
            name
            avatar
          }
        }
      `;

      const response = await axios.post(
        this.graphqlUrl,
        {
          query,
          variables: { teamId }
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.errors) {
        return null;
      }

      const team = response.data.data.team;

      return {
        teamId: team.id,
        teamSlug: team.id, // Railway doesn't have slugs, use ID
        teamName: team.name
      };
    } catch (error) {
      logger.warn(`Failed to fetch Railway team info for ${teamId}:`, error.message);
      // Don't fail if team info can't be fetched
      return null;
    }
  }

  /**
   * Connect Railway account for a user and organization
   * @param {Object} params - Connection parameters
   * @param {string} params.code - OAuth authorization code
   * @param {string} params.userId - User ID
   * @param {string} params.organizationId - Organization ID
   * @returns {Object} Connection data
   */
  async connectAccount({ code, userId, organizationId }) {
    if (!this.isAvailable()) {
      throw new AppError('Railway integration is not yet available', 503);
    }

    try {
      // Exchange code for token
      const tokenData = await this.exchangeCodeForToken(code);

      // Get user info
      const userInfo = await this.getUserInfo(tokenData.accessToken);

      // Calculate token expiration
      const tokenExpiresAt = tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000)
        : null;

      // Encrypt the tokens
      const encryptedAccessToken = encryption.encrypt(tokenData.accessToken);
      const encryptedRefreshToken = tokenData.refreshToken
        ? encryption.encrypt(tokenData.refreshToken)
        : null;

      // Check if connection already exists
      let connection = await RailwayConnection.findOne({
        organizationId,
        railwayUserId: userInfo.railwayUserId
      });

      if (connection) {
        // Update existing connection
        connection.userId = userId;
        connection.username = userInfo.username;
        connection.email = userInfo.email;
        connection.name = userInfo.name;
        connection.avatar = userInfo.avatar;
        connection.accessToken = encryptedAccessToken;
        connection.refreshToken = encryptedRefreshToken;
        connection.tokenType = tokenData.tokenType;
        connection.tokenExpiresAt = tokenExpiresAt;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();
      } else {
        // Create new connection
        const connectionData = {
          userId,
          organizationId,
          railwayUserId: userInfo.railwayUserId,
          username: userInfo.username,
          email: userInfo.email,
          name: userInfo.name,
          avatar: userInfo.avatar,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenType: tokenData.tokenType,
          tokenExpiresAt: tokenExpiresAt,
          status: 'active',
          lastSyncedAt: new Date()
        };

        connection = new RailwayConnection(connectionData);
      }

      await connection.save();

      logger.info(`Railway account connected for user ${userId} in organization ${organizationId}`);

      return {
        id: connection._id,
        railwayUserId: connection.railwayUserId,
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
      logger.error('Railway account connection failed:', error);
      throw error;
    }
  }

  /**
   * Disconnect Railway account
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   */
  async disconnectAccount(userId, organizationId) {
    try {
      const connection = await RailwayConnection.findOneAndDelete({
        userId,
        organizationId
      });

      if (!connection) {
        throw new AppError('Railway connection not found', 404);
      }

      logger.info(`Railway account disconnected for user ${userId} in organization ${organizationId}`);

      return { message: 'Railway account disconnected successfully' };
    } catch (error) {
      logger.error('Railway account disconnection failed:', error);
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
        message: 'Railway integration coming soon'
      };
    }

    const connection = await RailwayConnection.findOne({
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
      railwayUserId: connection.railwayUserId,
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
   * Get decrypted access token for API calls (with auto-refresh)
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {string} Decrypted access token
   */
  async getAccessToken(userId, organizationId) {
    const connection = await RailwayConnection.findOne({
      userId,
      organizationId
    }).select('+accessToken +refreshToken +tokenExpiresAt');

    if (!connection) {
      throw new AppError('Railway connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('Railway connection is not active', 403);
    }

    // Check if token is expired
    if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
      // Refresh the token
      const decryptedRefreshToken = encryption.decrypt(connection.refreshToken);
      const tokenData = await this.refreshAccessToken(decryptedRefreshToken);

      // Update connection with new tokens
      connection.accessToken = encryption.encrypt(tokenData.accessToken);
      if (tokenData.refreshToken) {
        connection.refreshToken = encryption.encrypt(tokenData.refreshToken);
      }
      connection.tokenExpiresAt = tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000)
        : null;
      await connection.save();

      return tokenData.accessToken;
    }

    return encryption.decrypt(connection.accessToken);
  }

  /**
   * Get connection by ID
   * @param {string} connectionId - Connection ID
   * @returns {Object} Connection
   */
  async getConnectionById(connectionId) {
    const connection = await RailwayConnection.findById(connectionId).select('+accessToken +refreshToken +tokenExpiresAt');

    if (!connection) {
      throw new AppError('Railway connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('Railway connection is not active', 403);
    }

    return connection;
  }
}

module.exports = new RailwayAuthService();
