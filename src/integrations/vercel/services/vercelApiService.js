const axios = require('axios');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

/**
 * Vercel REST API Client
 * Handles all direct API calls to Vercel REST API
 */
class VercelApiService {
  constructor() {
    this.apiUrl = 'https://api.vercel.com';
  }

  /**
   * Create axios instance with authentication
   * @param {string} accessToken - Vercel access token
   * @param {string} teamId - Optional team ID for team-scoped requests
   * @returns {Object} Axios instance
   */
  createClient(accessToken, teamId = null) {
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };

    const config = { headers };

    // Add team ID to all requests if provided
    if (teamId) {
      config.params = { teamId };
    }

    return axios.create({
      baseURL: this.apiUrl,
      ...config
    });
  }

  /**
   * Handle API errors consistently
   * @param {Error} error - Axios error
   * @param {string} operation - Operation description
   */
  handleError(error, operation) {
    logger.error(`Vercel API error during ${operation}:`, {
      status: error.response?.status,
      message: error.response?.data?.error?.message || error.message,
      data: error.response?.data
    });

    throw new AppError(
      error.response?.data?.error?.message || `Failed to ${operation}`,
      error.response?.status || 500
    );
  }

  // ============ PROJECTS API ============

  /**
   * List all projects
   * @param {string} accessToken - Vercel access token
   * @param {string} teamId - Optional team ID
   * @param {Object} options - Query options (limit, since, until, search)
   * @returns {Array} Projects
   */
  async listProjects(accessToken, teamId = null, options = {}) {
    try {
      const client = this.createClient(accessToken, teamId);
      const params = {};

      if (options.limit) params.limit = options.limit;
      if (options.since) params.since = options.since;
      if (options.until) params.until = options.until;
      if (options.search) params.search = options.search;

      const response = await client.get('/v9/projects', { params });
      return response.data.projects || [];
    } catch (error) {
      this.handleError(error, 'list projects');
    }
  }

  /**
   * Get a single project
   * @param {string} accessToken - Vercel access token
   * @param {string} projectId - Project ID or name
   * @param {string} teamId - Optional team ID
   * @returns {Object} Project details
   */
  async getProject(accessToken, projectId, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.get(`/v9/projects/${projectId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'get project');
    }
  }

  /**
   * Create a new project
   * @param {string} accessToken - Vercel access token
   * @param {Object} projectData - Project configuration
   * @param {string} teamId - Optional team ID
   * @returns {Object} Created project
   */
  async createProject(accessToken, projectData, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.post('/v9/projects', projectData);
      return response.data;
    } catch (error) {
      this.handleError(error, 'create project');
    }
  }

  // ============ DEPLOYMENTS API ============

  /**
   * List deployments
   * @param {string} accessToken - Vercel access token
   * @param {string} teamId - Optional team ID
   * @param {Object} options - Query options (projectId, limit, since, until, state, target)
   * @returns {Array} Deployments
   */
  async listDeployments(accessToken, teamId = null, options = {}) {
    try {
      const client = this.createClient(accessToken, teamId);
      const params = {};

      if (options.projectId) params.projectId = options.projectId;
      if (options.limit) params.limit = options.limit;
      if (options.since) params.since = options.since;
      if (options.until) params.until = options.until;
      if (options.state) params.state = options.state;
      if (options.target) params.target = options.target;

      const response = await client.get('/v6/deployments', { params });
      return response.data.deployments || [];
    } catch (error) {
      this.handleError(error, 'list deployments');
    }
  }

  /**
   * Get a single deployment
   * @param {string} accessToken - Vercel access token
   * @param {string} deploymentId - Deployment ID or URL
   * @param {string} teamId - Optional team ID
   * @returns {Object} Deployment details
   */
  async getDeployment(accessToken, deploymentId, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.get(`/v13/deployments/${deploymentId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'get deployment');
    }
  }

  /**
   * Create a new deployment
   * @param {string} accessToken - Vercel access token
   * @param {Object} deploymentData - Deployment configuration
   * @param {string} teamId - Optional team ID
   * @returns {Object} Created deployment
   */
  async createDeployment(accessToken, deploymentData, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.post('/v13/deployments', deploymentData);
      return response.data;
    } catch (error) {
      this.handleError(error, 'create deployment');
    }
  }

  /**
   * Cancel a deployment
   * @param {string} accessToken - Vercel access token
   * @param {string} deploymentId - Deployment ID
   * @param {string} teamId - Optional team ID
   * @returns {Object} Cancellation result
   */
  async cancelDeployment(accessToken, deploymentId, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.patch(`/v12/deployments/${deploymentId}/cancel`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'cancel deployment');
    }
  }

  // ============ DOMAINS API ============

  /**
   * List domains
   * @param {string} accessToken - Vercel access token
   * @param {string} teamId - Optional team ID
   * @param {Object} options - Query options (limit, since, until, projectId)
   * @returns {Array} Domains
   */
  async listDomains(accessToken, teamId = null, options = {}) {
    try {
      const client = this.createClient(accessToken, teamId);
      const params = {};

      if (options.limit) params.limit = options.limit;
      if (options.since) params.since = options.since;
      if (options.until) params.until = options.until;
      if (options.projectId) params.projectId = options.projectId;

      const response = await client.get('/v5/domains', { params });
      return response.data.domains || [];
    } catch (error) {
      this.handleError(error, 'list domains');
    }
  }

  /**
   * Get a single domain
   * @param {string} accessToken - Vercel access token
   * @param {string} domain - Domain name
   * @param {string} teamId - Optional team ID
   * @returns {Object} Domain details
   */
  async getDomain(accessToken, domain, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.get(`/v5/domains/${domain}`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'get domain');
    }
  }

  // ============ ENVIRONMENT VARIABLES API ============

  /**
   * List environment variables for a project
   * @param {string} accessToken - Vercel access token
   * @param {string} projectId - Project ID or name
   * @param {string} teamId - Optional team ID
   * @returns {Array} Environment variables
   */
  async listEnvironmentVariables(accessToken, projectId, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.get(`/v9/projects/${projectId}/env`);
      return response.data.envs || [];
    } catch (error) {
      this.handleError(error, 'list environment variables');
    }
  }

  /**
   * Create an environment variable
   * @param {string} accessToken - Vercel access token
   * @param {string} projectId - Project ID or name
   * @param {Object} envData - Environment variable data (key, value, type, target)
   * @param {string} teamId - Optional team ID
   * @returns {Object} Created environment variable
   */
  async createEnvironmentVariable(accessToken, projectId, envData, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.post(`/v10/projects/${projectId}/env`, envData);
      return response.data;
    } catch (error) {
      this.handleError(error, 'create environment variable');
    }
  }

  /**
   * Update an environment variable
   * @param {string} accessToken - Vercel access token
   * @param {string} projectId - Project ID or name
   * @param {string} envId - Environment variable ID
   * @param {Object} envData - Updated environment variable data
   * @param {string} teamId - Optional team ID
   * @returns {Object} Updated environment variable
   */
  async updateEnvironmentVariable(accessToken, projectId, envId, envData, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      const response = await client.patch(`/v9/projects/${projectId}/env/${envId}`, envData);
      return response.data;
    } catch (error) {
      this.handleError(error, 'update environment variable');
    }
  }

  /**
   * Delete an environment variable
   * @param {string} accessToken - Vercel access token
   * @param {string} projectId - Project ID or name
   * @param {string} envId - Environment variable ID
   * @param {string} teamId - Optional team ID
   * @returns {void}
   */
  async deleteEnvironmentVariable(accessToken, projectId, envId, teamId = null) {
    try {
      const client = this.createClient(accessToken, teamId);
      await client.delete(`/v9/projects/${projectId}/env/${envId}`);
    } catch (error) {
      this.handleError(error, 'delete environment variable');
    }
  }

  // ============ LOGS API ============

  /**
   * Get deployment logs
   * @param {string} accessToken - Vercel access token
   * @param {string} deploymentId - Deployment ID
   * @param {string} teamId - Optional team ID
   * @param {Object} options - Query options (follow, since, until, limit)
   * @returns {Array} Log entries
   */
  async getDeploymentLogs(accessToken, deploymentId, teamId = null, options = {}) {
    try {
      const client = this.createClient(accessToken, teamId);
      const params = {};

      if (options.follow) params.follow = options.follow;
      if (options.since) params.since = options.since;
      if (options.until) params.until = options.until;
      if (options.limit) params.limit = options.limit;

      const response = await client.get(`/v2/deployments/${deploymentId}/events`, { params });
      return response.data;
    } catch (error) {
      this.handleError(error, 'get deployment logs');
    }
  }

  // ============ TEAM API ============

  /**
   * Get team information
   * @param {string} accessToken - Vercel access token
   * @param {string} teamId - Team ID
   * @returns {Object} Team details
   */
  async getTeam(accessToken, teamId) {
    try {
      const client = this.createClient(accessToken, null);
      const response = await client.get(`/v2/teams/${teamId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'get team');
    }
  }

  /**
   * List user teams
   * @param {string} accessToken - Vercel access token
   * @returns {Array} Teams
   */
  async listTeams(accessToken) {
    try {
      const client = this.createClient(accessToken, null);
      const response = await client.get('/v2/teams');
      return response.data.teams || [];
    } catch (error) {
      this.handleError(error, 'list teams');
    }
  }

  // ============ USER API ============

  /**
   * Get authenticated user information
   * @param {string} accessToken - Vercel access token
   * @returns {Object} User details
   */
  async getUser(accessToken) {
    try {
      const client = this.createClient(accessToken, null);
      const response = await client.get('/v2/user');
      return response.data.user;
    } catch (error) {
      this.handleError(error, 'get user');
    }
  }
}

module.exports = new VercelApiService();
