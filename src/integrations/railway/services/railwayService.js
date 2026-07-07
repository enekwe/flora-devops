const railwayAuthService = require('./railwayAuthService');
const railwayApiService = require('./railwayApiService');
const RailwayConnection = require('../models/RailwayConnection');
const encryption = require('../../../utils/encryption');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

/**
 * High-level Railway service
 * Orchestrates authentication and API operations
 */
class RailwayService {
  /**
   * Get access token by connection ID
   * @param {string} connectionId - Connection ID
   * @returns {Object} { accessToken, teamId }
   */
  async getAccessTokenByConnectionId(connectionId) {
    const connection = await RailwayConnection.findById(connectionId).select('+accessToken +refreshToken +tokenExpiresAt');

    if (!connection) {
      throw new AppError('Railway connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('Railway connection is not active', 403);
    }

    // Check if token is expired and refresh if needed
    if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
      const decryptedRefreshToken = encryption.decrypt(connection.refreshToken);
      const tokenData = await railwayAuthService.refreshAccessToken(decryptedRefreshToken);

      // Update connection with new tokens
      connection.accessToken = encryption.encrypt(tokenData.accessToken);
      if (tokenData.refreshToken) {
        connection.refreshToken = encryption.encrypt(tokenData.refreshToken);
      }
      connection.tokenExpiresAt = tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000)
        : null;
      await connection.save();

      return {
        accessToken: tokenData.accessToken,
        teamId: connection.teamId || null
      };
    }

    const accessToken = encryption.decrypt(connection.accessToken);

    return {
      accessToken,
      teamId: connection.teamId || null
    };
  }

  /**
   * Get access token by user and organization
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {Object} { accessToken, teamId }
   */
  async getAccessTokenByUserOrg(userId, organizationId) {
    const connection = await RailwayConnection.findOne({
      userId,
      organizationId,
      status: 'active'
    }).select('+accessToken +refreshToken +tokenExpiresAt');

    if (!connection) {
      throw new AppError('Railway connection not found', 404);
    }

    // Check if token is expired and refresh if needed
    if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
      const decryptedRefreshToken = encryption.decrypt(connection.refreshToken);
      const tokenData = await railwayAuthService.refreshAccessToken(decryptedRefreshToken);

      // Update connection with new tokens
      connection.accessToken = encryption.encrypt(tokenData.accessToken);
      if (tokenData.refreshToken) {
        connection.refreshToken = encryption.encrypt(tokenData.refreshToken);
      }
      connection.tokenExpiresAt = tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000)
        : null;
      await connection.save();

      return {
        accessToken: tokenData.accessToken,
        teamId: connection.teamId || null
      };
    }

    const accessToken = encryption.decrypt(connection.accessToken);

    return {
      accessToken,
      teamId: connection.teamId || null
    };
  }

  // ============ PROJECTS ============

  /**
   * List projects for a connection
   * @param {string} connectionId - Connection ID
   * @param {string} teamId - Optional team ID override
   * @param {Object} options - Query options
   * @returns {Array} Projects
   */
  async listProjects(connectionId, teamId = null, options = {}) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const projects = await railwayApiService.listProjects(accessToken, options);

      // Update connection with project data
      const connection = await RailwayConnection.findById(connectionId);
      if (connection) {
        projects.forEach(project => {
          connection.addProject(project);
        });
        connection.metrics.totalProjects = projects.length;
        await connection.save();
      }

      return projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        services: p.services,
        latestDeployment: p.latestDeployment
      }));
    } catch (error) {
      logger.error('Failed to list Railway projects:', error);
      throw error;
    }
  }

  /**
   * Get a single project
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Project details
   */
  async getProject(connectionId, projectId, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const project = await railwayApiService.getProject(accessToken, projectId);

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        services: project.services,
        environments: project.environments
      };
    } catch (error) {
      logger.error('Failed to get Railway project:', error);
      throw error;
    }
  }

  /**
   * Create a new project
   * @param {string} connectionId - Connection ID
   * @param {Object} projectData - Project configuration
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Created project
   */
  async createProject(connectionId, projectData, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const project = await railwayApiService.createProject(accessToken, projectData);

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt
      };
    } catch (error) {
      logger.error('Failed to create Railway project:', error);
      throw error;
    }
  }

  // ============ DEPLOYMENTS ============

  /**
   * List deployments for a service
   * @param {string} connectionId - Connection ID
   * @param {string} serviceId - Service ID
   * @param {string} teamId - Optional team ID override
   * @param {Object} options - Query options
   * @returns {Array} Deployments
   */
  async listDeployments(connectionId, serviceId, teamId = null, options = {}) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const deployments = await railwayApiService.listDeployments(
        accessToken,
        serviceId,
        options
      );

      // Update connection metrics
      const connection = await RailwayConnection.findById(connectionId);
      if (connection && deployments.length > 0) {
        connection.metrics.totalDeployments = (connection.metrics.totalDeployments || 0) + deployments.length;
        connection.metrics.lastDeploymentAt = new Date(deployments[0].createdAt);
        await connection.save();
      }

      return deployments.map(d => ({
        id: d.id,
        status: d.status,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        meta: d.meta,
        staticUrl: d.staticUrl
      }));
    } catch (error) {
      logger.error('Failed to list Railway deployments:', error);
      throw error;
    }
  }

  /**
   * Get a single deployment
   * @param {string} connectionId - Connection ID
   * @param {string} deploymentId - Deployment ID
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Deployment details
   */
  async getDeployment(connectionId, deploymentId, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const deployment = await railwayApiService.getDeployment(accessToken, deploymentId);

      return {
        id: deployment.id,
        status: deployment.status,
        createdAt: deployment.createdAt,
        updatedAt: deployment.updatedAt,
        meta: deployment.meta,
        staticUrl: deployment.staticUrl,
        buildLogs: deployment.buildLogs
      };
    } catch (error) {
      logger.error('Failed to get Railway deployment:', error);
      throw error;
    }
  }

  /**
   * Trigger a new deployment
   * @param {string} connectionId - Connection ID
   * @param {string} serviceId - Service ID
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Created deployment
   */
  async triggerDeployment(connectionId, serviceId, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const deployment = await railwayApiService.triggerDeployment(accessToken, serviceId);

      return {
        id: deployment.id,
        status: deployment.status,
        createdAt: deployment.createdAt
      };
    } catch (error) {
      logger.error('Failed to trigger Railway deployment:', error);
      throw error;
    }
  }

  /**
   * Get deployment logs
   * @param {string} connectionId - Connection ID
   * @param {string} deploymentId - Deployment ID
   * @param {string} teamId - Optional team ID override
   * @param {Object} options - Query options
   * @returns {Object} Logs
   */
  async getDeploymentLogs(connectionId, deploymentId, teamId = null, options = {}) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      return await railwayApiService.getDeploymentLogs(accessToken, deploymentId, options);
    } catch (error) {
      logger.error('Failed to get deployment logs:', error);
      throw error;
    }
  }

  // ============ SERVICES ============

  /**
   * List services for a project
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID
   * @param {string} teamId - Optional team ID override
   * @returns {Array} Services
   */
  async listServices(connectionId, projectId, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const services = await railwayApiService.listServices(accessToken, projectId);

      return services.map(s => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }));
    } catch (error) {
      logger.error('Failed to list Railway services:', error);
      throw error;
    }
  }

  /**
   * Get a single service
   * @param {string} connectionId - Connection ID
   * @param {string} serviceId - Service ID
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Service details
   */
  async getService(connectionId, serviceId, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const service = await railwayApiService.getService(accessToken, serviceId);

      return {
        id: service.id,
        name: service.name,
        icon: service.icon,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        recentDeployments: service.recentDeployments
      };
    } catch (error) {
      logger.error('Failed to get Railway service:', error);
      throw error;
    }
  }

  /**
   * Create a new service
   * @param {string} connectionId - Connection ID
   * @param {Object} serviceData - Service configuration
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Created service
   */
  async createService(connectionId, serviceData, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const service = await railwayApiService.createService(accessToken, serviceData);

      return {
        id: service.id,
        name: service.name,
        createdAt: service.createdAt
      };
    } catch (error) {
      logger.error('Failed to create Railway service:', error);
      throw error;
    }
  }

  // ============ ENVIRONMENT VARIABLES ============

  /**
   * Get environment variables for a service
   * @param {string} connectionId - Connection ID
   * @param {string} serviceId - Service ID
   * @param {string} teamId - Optional team ID override
   * @returns {Array} Environment variables
   */
  async getEnvironmentVariables(connectionId, serviceId, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      const envs = await railwayApiService.listEnvironmentVariables(accessToken, serviceId);

      return envs.map(e => ({
        key: e.key,
        value: e.value
      }));
    } catch (error) {
      logger.error('Failed to get environment variables:', error);
      throw error;
    }
  }

  /**
   * Set environment variables for a service
   * @param {string} connectionId - Connection ID
   * @param {string} serviceId - Service ID
   * @param {Object} variables - Environment variables (key-value pairs)
   * @param {string} teamId - Optional team ID override
   * @returns {boolean} Success
   */
  async setEnvironmentVariables(connectionId, serviceId, variables, teamId = null) {
    try {
      const { accessToken } = await this.getAccessTokenByConnectionId(connectionId);

      await railwayApiService.setEnvironmentVariables(accessToken, serviceId, variables);

      logger.info(`Environment variables updated for service ${serviceId}`);
      return true;
    } catch (error) {
      logger.error('Failed to set environment variables:', error);
      throw error;
    }
  }

  // ============ CONNECTION MANAGEMENT ============

  /**
   * Get connection by user and organization
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {Object} Connection
   */
  async getConnection(userId, organizationId) {
    const connection = await RailwayConnection.findOne({
      userId,
      organizationId
    });

    if (!connection) {
      throw new AppError('Railway connection not found', 404);
    }

    return connection;
  }

  /**
   * Update connection health check
   * @param {string} connectionId - Connection ID
   * @param {boolean} success - Health check success
   * @param {string} errorMessage - Optional error message
   */
  async updateHealthCheck(connectionId, success, errorMessage = null) {
    try {
      const connection = await RailwayConnection.findById(connectionId);

      if (!connection) {
        return;
      }

      connection.health = connection.health || {};
      connection.health.lastCheck = new Date();

      if (success) {
        connection.health.consecutiveFailures = 0;
        connection.health.errorMessage = null;
        connection.status = 'active';
      } else {
        connection.health.consecutiveFailures = (connection.health.consecutiveFailures || 0) + 1;
        connection.health.errorMessage = errorMessage;

        // Mark as error after 3 consecutive failures
        if (connection.health.consecutiveFailures >= 3) {
          connection.status = 'error';
        }
      }

      await connection.save();
    } catch (error) {
      logger.error('Failed to update health check:', error);
    }
  }
}

module.exports = new RailwayService();
