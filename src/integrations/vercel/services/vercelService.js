const vercelAuthService = require('./vercelAuthService');
const vercelApiService = require('./vercelApiService');
const VercelConnection = require('../models/VercelConnection');
const encryption = require('../../../utils/encryption');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

/**
 * High-level Vercel service
 * Orchestrates authentication and API operations
 */
class VercelService {
  /**
   * Get access token by connection ID
   * @param {string} connectionId - Connection ID
   * @returns {Object} { accessToken, teamId }
   */
  async getAccessTokenByConnectionId(connectionId) {
    const connection = await VercelConnection.findById(connectionId).select('+accessToken');

    if (!connection) {
      throw new AppError('Vercel connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('Vercel connection is not active', 403);
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
    const connection = await VercelConnection.findOne({
      userId,
      organizationId,
      status: 'active'
    }).select('+accessToken');

    if (!connection) {
      throw new AppError('Vercel connection not found', 404);
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
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const projects = await vercelApiService.listProjects(accessToken, effectiveTeamId, options);

      // Update connection with project data
      const connection = await VercelConnection.findById(connectionId);
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
        framework: p.framework,
        link: p.link,
        devCommand: p.devCommand,
        buildCommand: p.buildCommand,
        outputDirectory: p.outputDirectory,
        nodeVersion: p.nodeVersion,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        latestDeployment: p.latestDeployment
      }));
    } catch (error) {
      logger.error('Failed to list Vercel projects:', error);
      throw error;
    }
  }

  /**
   * Get a single project
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID or name
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Project details
   */
  async getProject(connectionId, projectId, teamId = null) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const project = await vercelApiService.getProject(accessToken, projectId, effectiveTeamId);

      return {
        id: project.id,
        name: project.name,
        framework: project.framework,
        link: project.link,
        devCommand: project.devCommand,
        buildCommand: project.buildCommand,
        outputDirectory: project.outputDirectory,
        nodeVersion: project.nodeVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        latestDeployment: project.latestDeployment,
        env: project.env,
        targets: project.targets
      };
    } catch (error) {
      logger.error('Failed to get Vercel project:', error);
      throw error;
    }
  }

  /**
   * Create a new project
   * @param {string} connectionId - Connection ID
   * @param {Object} projectData - Project configuration (name, framework, etc.)
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Created project
   */
  async createProject(connectionId, projectData, teamId = null) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const project = await vercelApiService.createProject(accessToken, projectData, effectiveTeamId);

      return {
        id: project.id,
        name: project.name,
        framework: project.framework,
        link: project.link,
        createdAt: project.createdAt
      };
    } catch (error) {
      logger.error('Failed to create Vercel project:', error);
      throw error;
    }
  }

  // ============ DEPLOYMENTS ============

  /**
   * List deployments for a project
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID
   * @param {string} teamId - Optional team ID override
   * @param {Object} options - Query options
   * @returns {Array} Deployments
   */
  async listDeployments(connectionId, projectId, teamId = null, options = {}) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const deployments = await vercelApiService.listDeployments(
        accessToken,
        effectiveTeamId,
        { projectId, ...options }
      );

      // Update connection metrics
      const connection = await VercelConnection.findById(connectionId);
      if (connection && deployments.length > 0) {
        connection.metrics.totalDeployments = (connection.metrics.totalDeployments || 0) + deployments.length;
        connection.metrics.lastDeploymentAt = new Date(deployments[0].createdAt);
        await connection.save();
      }

      return deployments.map(d => ({
        uid: d.uid,
        name: d.name,
        url: d.url,
        state: d.state,
        readyState: d.readyState,
        type: d.type,
        createdAt: d.createdAt,
        buildingAt: d.buildingAt,
        ready: d.ready,
        target: d.target,
        creator: d.creator,
        inspectorUrl: d.inspectorUrl
      }));
    } catch (error) {
      logger.error('Failed to list Vercel deployments:', error);
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
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const deployment = await vercelApiService.getDeployment(accessToken, deploymentId, effectiveTeamId);

      return {
        uid: deployment.uid,
        name: deployment.name,
        url: deployment.url,
        state: deployment.state,
        readyState: deployment.readyState,
        type: deployment.type,
        createdAt: deployment.createdAt,
        buildingAt: deployment.buildingAt,
        ready: deployment.ready,
        target: deployment.target,
        creator: deployment.creator,
        inspectorUrl: deployment.inspectorUrl,
        meta: deployment.meta,
        source: deployment.source,
        build: deployment.build
      };
    } catch (error) {
      logger.error('Failed to get Vercel deployment:', error);
      throw error;
    }
  }

  /**
   * Get deployment logs
   * @param {string} connectionId - Connection ID
   * @param {string} deploymentId - Deployment ID
   * @param {string} teamId - Optional team ID override
   * @param {Object} options - Query options
   * @returns {Array} Log entries
   */
  async getDeploymentLogs(connectionId, deploymentId, teamId = null, options = {}) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      return await vercelApiService.getDeploymentLogs(accessToken, deploymentId, effectiveTeamId, options);
    } catch (error) {
      logger.error('Failed to get deployment logs:', error);
      throw error;
    }
  }

  // ============ DOMAINS ============

  /**
   * List domains
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Optional project ID to filter
   * @param {string} teamId - Optional team ID override
   * @param {Object} options - Query options
   * @returns {Array} Domains
   */
  async listDomains(connectionId, projectId = null, teamId = null, options = {}) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const domainOptions = { ...options };
      if (projectId) {
        domainOptions.projectId = projectId;
      }

      const domains = await vercelApiService.listDomains(accessToken, effectiveTeamId, domainOptions);

      return domains.map(d => ({
        name: d.name,
        verified: d.verified,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        nameservers: d.nameservers,
        intendedNameservers: d.intendedNameservers,
        creator: d.creator
      }));
    } catch (error) {
      logger.error('Failed to list domains:', error);
      throw error;
    }
  }

  // ============ ENVIRONMENT VARIABLES ============

  /**
   * Get environment variables for a project
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID
   * @param {string} teamId - Optional team ID override
   * @returns {Array} Environment variables
   */
  async getEnvironmentVariables(connectionId, projectId, teamId = null) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const envs = await vercelApiService.listEnvironmentVariables(accessToken, projectId, effectiveTeamId);

      return envs.map(e => ({
        id: e.id,
        key: e.key,
        value: e.value,
        type: e.type,
        target: e.target,
        gitBranch: e.gitBranch,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt
      }));
    } catch (error) {
      logger.error('Failed to get environment variables:', error);
      throw error;
    }
  }

  /**
   * Create an environment variable
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID
   * @param {Object} envData - Environment variable data
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Created environment variable
   */
  async createEnvironmentVariable(connectionId, projectId, envData, teamId = null) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const env = await vercelApiService.createEnvironmentVariable(
        accessToken,
        projectId,
        envData,
        effectiveTeamId
      );

      return {
        id: env.id,
        key: env.key,
        value: env.value,
        type: env.type,
        target: env.target,
        createdAt: env.createdAt
      };
    } catch (error) {
      logger.error('Failed to create environment variable:', error);
      throw error;
    }
  }

  /**
   * Update an environment variable
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID
   * @param {string} envId - Environment variable ID
   * @param {Object} envData - Updated environment variable data
   * @param {string} teamId - Optional team ID override
   * @returns {Object} Updated environment variable
   */
  async updateEnvironmentVariable(connectionId, projectId, envId, envData, teamId = null) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      const env = await vercelApiService.updateEnvironmentVariable(
        accessToken,
        projectId,
        envId,
        envData,
        effectiveTeamId
      );

      return {
        id: env.id,
        key: env.key,
        value: env.value,
        type: env.type,
        target: env.target,
        updatedAt: env.updatedAt
      };
    } catch (error) {
      logger.error('Failed to update environment variable:', error);
      throw error;
    }
  }

  /**
   * Delete an environment variable
   * @param {string} connectionId - Connection ID
   * @param {string} projectId - Project ID
   * @param {string} envId - Environment variable ID
   * @param {string} teamId - Optional team ID override
   * @returns {void}
   */
  async deleteEnvironmentVariable(connectionId, projectId, envId, teamId = null) {
    try {
      const { accessToken, teamId: connectionTeamId } = await this.getAccessTokenByConnectionId(connectionId);
      const effectiveTeamId = teamId || connectionTeamId;

      await vercelApiService.deleteEnvironmentVariable(
        accessToken,
        projectId,
        envId,
        effectiveTeamId
      );

      logger.info(`Environment variable ${envId} deleted for project ${projectId}`);
    } catch (error) {
      logger.error('Failed to delete environment variable:', error);
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
    const connection = await VercelConnection.findOne({
      userId,
      organizationId
    });

    if (!connection) {
      throw new AppError('Vercel connection not found', 404);
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
      const connection = await VercelConnection.findById(connectionId);

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

module.exports = new VercelService();
