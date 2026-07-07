const axios = require('axios');
const config = require('../../../config');
const encryption = require('../../../utils/encryption');
const DeploymentConnection = require('../models/DeploymentConnection');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class DeploymentService {
  // === VERCEL ===

  /**
   * Get Vercel authorization URL
   */
  getVercelAuthUrl({ userId, organizationId, state }) {
    const params = new URLSearchParams({
      client_id: config.VERCEL_CLIENT_ID,
      redirect_uri: config.VERCEL_CALLBACK_URL,
      state: JSON.stringify({ userId, organizationId, token: state, platform: 'vercel' })
    });

    return `https://vercel.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange Vercel code for token
   */
  async exchangeVercelCode(code) {
    try {
      const response = await axios.post('https://api.vercel.com/v2/oauth/access_token', {
        client_id: config.VERCEL_CLIENT_ID,
        client_secret: config.VERCEL_CLIENT_SECRET,
        code,
        redirect_uri: config.VERCEL_CALLBACK_URL
      });

      return {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type,
        teamId: response.data.team_id,
        userId: response.data.user_id
      };
    } catch (error) {
      logger.error('Vercel token exchange failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to exchange Vercel code',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get Vercel user info
   */
  async getVercelUserInfo(accessToken) {
    try {
      const response = await axios.get('https://api.vercel.com/v2/user', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      return {
        platformUserId: response.data.user.id,
        platformUsername: response.data.user.username,
        platformEmail: response.data.user.email
      };
    } catch (error) {
      logger.error('Failed to get Vercel user info:', error);
      throw new AppError('Failed to get Vercel user info', error.response?.status || 500);
    }
  }

  /**
   * Connect Vercel account
   */
  async connectVercel({ code, userId, organizationId }) {
    try {
      const tokenData = await this.exchangeVercelCode(code);
      const userInfo = await this.getVercelUserInfo(tokenData.accessToken);

      const encryptedAccessToken = encryption.encrypt(tokenData.accessToken);

      let connection = await DeploymentConnection.findOne({
        organizationId,
        platform: 'vercel',
        platformUserId: userInfo.platformUserId
      });

      if (connection) {
        connection.userId = userId;
        connection.platformUsername = userInfo.platformUsername;
        connection.platformEmail = userInfo.platformEmail;
        connection.platformTeamId = tokenData.teamId;
        connection.accessToken = encryptedAccessToken;
        connection.tokenType = tokenData.tokenType;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();
      } else {
        connection = new DeploymentConnection({
          userId,
          organizationId,
          platform: 'vercel',
          platformUserId: userInfo.platformUserId,
          platformUsername: userInfo.platformUsername,
          platformEmail: userInfo.platformEmail,
          platformTeamId: tokenData.teamId,
          accessToken: encryptedAccessToken,
          tokenType: tokenData.tokenType,
          status: 'active',
          lastSyncedAt: new Date()
        });
      }

      await connection.save();

      logger.info(`Vercel connected for user ${userId} in org ${organizationId}`);

      return {
        id: connection._id,
        platform: 'vercel',
        username: connection.platformUsername,
        email: connection.platformEmail,
        status: connection.status
      };
    } catch (error) {
      logger.error('Vercel connection failed:', error);
      throw error;
    }
  }

  /**
   * List Vercel projects
   */
  async listVercelProjects(userId, organizationId, options = {}) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId, 'vercel');

      const params = new URLSearchParams();
      if (options.limit) params.append('limit', options.limit);

      const response = await axios.get(`https://api.vercel.com/v9/projects?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const connection = await DeploymentConnection.findOne({
        userId,
        organizationId,
        platform: 'vercel'
      });

      if (connection) {
        response.data.projects.forEach(project => connection.addProject(project));
        await connection.save();
      }

      return response.data.projects.map(p => ({
        id: p.id,
        name: p.name,
        framework: p.framework,
        productionDeployment: p.targets?.production,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }));
    } catch (error) {
      logger.error('Failed to list Vercel projects:', error);
      throw new AppError(
        error.response?.data?.error?.message || 'Failed to list Vercel projects',
        error.response?.status || 500
      );
    }
  }

  /**
   * List Vercel deployments
   */
  async listVercelDeployments(userId, organizationId, projectId) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId, 'vercel');

      const response = await axios.get(
        `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=10`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      return response.data.deployments.map(d => ({
        uid: d.uid,
        name: d.name,
        url: d.url,
        state: d.state,
        type: d.type,
        createdAt: d.createdAt,
        buildingAt: d.buildingAt,
        ready: d.ready
      }));
    } catch (error) {
      logger.error('Failed to list Vercel deployments:', error);
      throw new AppError(
        error.response?.data?.error?.message || 'Failed to list deployments',
        error.response?.status || 500
      );
    }
  }

  // === NETLIFY ===

  /**
   * Get Netlify authorization URL
   */
  getNetlifyAuthUrl({ userId, organizationId, state }) {
    const params = new URLSearchParams({
      client_id: config.NETLIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: config.NETLIFY_CALLBACK_URL,
      state: JSON.stringify({ userId, organizationId, token: state, platform: 'netlify' })
    });

    return `https://app.netlify.com/authorize?${params.toString()}`;
  }

  /**
   * Exchange Netlify code for token
   */
  async exchangeNetlifyCode(code) {
    try {
      const response = await axios.post('https://api.netlify.com/oauth/token', {
        client_id: config.NETLIFY_CLIENT_ID,
        client_secret: config.NETLIFY_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: config.NETLIFY_CALLBACK_URL
      });

      return {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type
      };
    } catch (error) {
      logger.error('Netlify token exchange failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to exchange Netlify code',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get Netlify user info
   */
  async getNetlifyUserInfo(accessToken) {
    try {
      const response = await axios.get('https://api.netlify.com/api/v1/user', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      return {
        platformUserId: response.data.id,
        platformUsername: response.data.full_name || response.data.email,
        platformEmail: response.data.email
      };
    } catch (error) {
      logger.error('Failed to get Netlify user info:', error);
      throw new AppError('Failed to get Netlify user info', error.response?.status || 500);
    }
  }

  /**
   * Connect Netlify account
   */
  async connectNetlify({ code, userId, organizationId }) {
    try {
      const tokenData = await this.exchangeNetlifyCode(code);
      const userInfo = await this.getNetlifyUserInfo(tokenData.accessToken);

      const encryptedAccessToken = encryption.encrypt(tokenData.accessToken);

      let connection = await DeploymentConnection.findOne({
        organizationId,
        platform: 'netlify',
        platformUserId: userInfo.platformUserId
      });

      if (connection) {
        connection.userId = userId;
        connection.platformUsername = userInfo.platformUsername;
        connection.platformEmail = userInfo.platformEmail;
        connection.accessToken = encryptedAccessToken;
        connection.tokenType = tokenData.tokenType;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();
      } else {
        connection = new DeploymentConnection({
          userId,
          organizationId,
          platform: 'netlify',
          platformUserId: userInfo.platformUserId,
          platformUsername: userInfo.platformUsername,
          platformEmail: userInfo.platformEmail,
          accessToken: encryptedAccessToken,
          tokenType: tokenData.tokenType,
          status: 'active',
          lastSyncedAt: new Date()
        });
      }

      await connection.save();

      logger.info(`Netlify connected for user ${userId} in org ${organizationId}`);

      return {
        id: connection._id,
        platform: 'netlify',
        username: connection.platformUsername,
        email: connection.platformEmail,
        status: connection.status
      };
    } catch (error) {
      logger.error('Netlify connection failed:', error);
      throw error;
    }
  }

  /**
   * List Netlify sites
   */
  async listNetlifySites(userId, organizationId) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId, 'netlify');

      const response = await axios.get('https://api.netlify.com/api/v1/sites', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const connection = await DeploymentConnection.findOne({
        userId,
        organizationId,
        platform: 'netlify'
      });

      if (connection) {
        response.data.forEach(site => connection.addProject({
          id: site.id,
          name: site.name,
          url: site.url,
          framework: null,
          production: {
            domain: site.custom_domain || site.default_domain,
            status: site.state,
            url: site.ssl_url || site.url
          }
        }));
        await connection.save();
      }

      return response.data.map(site => ({
        id: site.id,
        name: site.name,
        url: site.url,
        customDomain: site.custom_domain,
        state: site.state,
        createdAt: site.created_at,
        updatedAt: site.updated_at
      }));
    } catch (error) {
      logger.error('Failed to list Netlify sites:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list Netlify sites',
        error.response?.status || 500
      );
    }
  }

  /**
   * List Netlify deploys
   */
  async listNetlifyDeploys(userId, organizationId, siteId) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId, 'netlify');

      const response = await axios.get(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      return response.data.map(deploy => ({
        id: deploy.id,
        state: deploy.state,
        branch: deploy.branch,
        commitUrl: deploy.commit_url,
        deployUrl: deploy.deploy_url,
        deployTime: deploy.deploy_time,
        createdAt: deploy.created_at,
        updatedAt: deploy.updated_at
      }));
    } catch (error) {
      logger.error('Failed to list Netlify deploys:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list deploys',
        error.response?.status || 500
      );
    }
  }

  // === COMMON METHODS ===

  /**
   * Disconnect deployment platform
   */
  async disconnect(userId, organizationId, platform) {
    try {
      const connection = await DeploymentConnection.findOneAndDelete({
        userId,
        organizationId,
        platform
      });

      if (!connection) {
        throw new AppError(`${platform} connection not found`, 404);
      }

      logger.info(`${platform} disconnected for user ${userId} in org ${organizationId}`);

      return { message: `${platform} account disconnected successfully` };
    } catch (error) {
      logger.error(`${platform} disconnection failed:`, error);
      throw error;
    }
  }

  /**
   * Get connection status
   */
  async getStatus(userId, organizationId, platform) {
    const connection = await DeploymentConnection.findOne({
      userId,
      organizationId,
      platform
    });

    if (!connection) {
      return { connected: false };
    }

    return {
      connected: true,
      platform: connection.platform,
      username: connection.platformUsername,
      email: connection.platformEmail,
      status: connection.status,
      lastSyncedAt: connection.lastSyncedAt,
      projectCount: connection.projects.length
    };
  }

  /**
   * Get decrypted access token
   */
  async getAccessToken(userId, organizationId, platform) {
    const connection = await DeploymentConnection.findOne({
      userId,
      organizationId,
      platform
    }).select('+accessToken');

    if (!connection) {
      throw new AppError(`${platform} connection not found`, 404);
    }

    if (connection.status !== 'active') {
      throw new AppError(`${platform} connection is not active`, 403);
    }

    return encryption.decrypt(connection.accessToken);
  }
}

module.exports = new DeploymentService();
