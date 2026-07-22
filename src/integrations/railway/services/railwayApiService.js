const axios = require('axios');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

/**
 * Railway GraphQL API Client
 * Handles all direct API calls to Railway GraphQL API
 */
class RailwayApiService {
  constructor() {
    this.graphqlUrl = 'https://backboard.railway.app/graphql/v2';
  }

  /**
   * Create axios instance with authentication
   * @param {string} accessToken - Railway access token
   * @returns {Object} Axios instance
   */
  createClient(accessToken) {
    return axios.create({
      baseURL: this.graphqlUrl,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Execute GraphQL query
   * @param {string} accessToken - Railway access token
   * @param {string} query - GraphQL query
   * @param {Object} variables - Query variables
   * @returns {Object} Query result
   */
  async executeQuery(accessToken, query, variables = {}) {
    try {
      const client = this.createClient(accessToken);
      const response = await client.post('', {
        query,
        variables
      });

      if (response.data.errors) {
        throw new AppError(
          `Railway GraphQL error: ${response.data.errors[0].message}`,
          400
        );
      }

      return response.data.data;
    } catch (error) {
      logger.error('Railway GraphQL query failed:', error);
      throw error;
    }
  }

  /**
   * Handle API errors consistently
   * @param {Error} error - Axios error
   * @param {string} operation - Operation description
   */
  handleError(error, operation) {
    logger.error(`Railway API error during ${operation}:`, {
      status: error.response?.status,
      message: error.response?.data?.errors?.[0]?.message || error.message,
      data: error.response?.data
    });

    throw new AppError(
      error.response?.data?.errors?.[0]?.message || `Failed to ${operation}`,
      error.response?.status || 500
    );
  }

  // ============ USER API ============

  /**
   * Get authenticated user information
   * @param {string} accessToken - Railway access token
   * @returns {Object} User details
   */
  async getUser(accessToken) {
    try {
      const query = `
        query {
          me {
            id
            name
            email
            username
            avatar
            createdAt
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query);
      return data.me;
    } catch (error) {
      this.handleError(error, 'get user');
    }
  }

  // ============ PROJECTS API ============

  /**
   * List all projects
   * @param {string} accessToken - Railway access token
   * @param {Object} options - Query options (teamId)
   * @returns {Array} Projects
   */
  async listProjects(accessToken, options = {}) {
    try {
      const query = `
        query {
          projects {
            edges {
              node {
                id
                name
                description
                createdAt
                updatedAt
                services {
                  edges {
                    node {
                      id
                      name
                      icon
                      createdAt
                      updatedAt
                    }
                  }
                }
                deployments(first: 1) {
                  edges {
                    node {
                      id
                      status
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query);
      return data.projects.edges.map(edge => ({
        id: edge.node.id,
        name: edge.node.name,
        description: edge.node.description,
        createdAt: edge.node.createdAt,
        updatedAt: edge.node.updatedAt,
        services: edge.node.services.edges.map(s => s.node),
        latestDeployment: edge.node.deployments.edges[0]?.node || null
      }));
    } catch (error) {
      this.handleError(error, 'list projects');
    }
  }

  /**
   * Get a single project
   * @param {string} accessToken - Railway access token
   * @param {string} projectId - Project ID
   * @returns {Object} Project details
   */
  async getProject(accessToken, projectId) {
    try {
      const query = `
        query($projectId: String!) {
          project(id: $projectId) {
            id
            name
            description
            createdAt
            updatedAt
            services {
              edges {
                node {
                  id
                  name
                  icon
                  createdAt
                  updatedAt
                }
              }
            }
            environments {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { projectId });
      const project = data.project;

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        services: project.services.edges.map(s => s.node),
        environments: project.environments.edges.map(e => e.node)
      };
    } catch (error) {
      this.handleError(error, 'get project');
    }
  }

  /**
   * Create a new project
   * @param {string} accessToken - Railway access token
   * @param {Object} projectData - Project configuration
   * @returns {Object} Created project
   */
  async createProject(accessToken, projectData) {
    try {
      const query = `
        mutation($name: String!, $description: String, $teamId: String) {
          projectCreate(input: {
            name: $name
            description: $description
            teamId: $teamId
          }) {
            id
            name
            description
            createdAt
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, projectData);
      return data.projectCreate;
    } catch (error) {
      this.handleError(error, 'create project');
    }
  }

  /**
   * Delete a project
   * @param {string} accessToken - Railway access token
   * @param {string} projectId - Project ID
   * @returns {boolean} Success
   */
  async deleteProject(accessToken, projectId) {
    try {
      const query = `
        mutation($projectId: String!) {
          projectDelete(id: $projectId)
        }
      `;

      await this.executeQuery(accessToken, query, { projectId });
      return true;
    } catch (error) {
      this.handleError(error, 'delete project');
    }
  }

  // ============ DEPLOYMENTS API ============

  /**
   * List deployments for a service
   * @param {string} accessToken - Railway access token
   * @param {string} serviceId - Service ID
   * @param {Object} options - Query options (first, status)
   * @returns {Array} Deployments
   */
  async listDeployments(accessToken, serviceId, options = {}) {
    try {
      const first = options.first || 20;
      const query = `
        query($serviceId: String!, $first: Int!) {
          service(id: $serviceId) {
            id
            deployments(first: $first) {
              edges {
                node {
                  id
                  status
                  createdAt
                  updatedAt
                  meta
                  staticUrl
                }
              }
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { serviceId, first });
      return data.service.deployments.edges.map(edge => edge.node);
    } catch (error) {
      this.handleError(error, 'list deployments');
    }
  }

  /**
   * Get a single deployment
   * @param {string} accessToken - Railway access token
   * @param {string} deploymentId - Deployment ID
   * @returns {Object} Deployment details
   */
  async getDeployment(accessToken, deploymentId) {
    try {
      const query = `
        query($deploymentId: String!) {
          deployment(id: $deploymentId) {
            id
            status
            createdAt
            updatedAt
            meta
            staticUrl
            buildLogs
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { deploymentId });
      return data.deployment;
    } catch (error) {
      this.handleError(error, 'get deployment');
    }
  }

  /**
   * Trigger a new deployment
   * @param {string} accessToken - Railway access token
   * @param {string} serviceId - Service ID
   * @returns {Object} Created deployment
   */
  async triggerDeployment(accessToken, serviceId) {
    try {
      const query = `
        mutation($serviceId: String!) {
          serviceInstanceDeploy(serviceId: $serviceId) {
            id
            status
            createdAt
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { serviceId });
      return data.serviceInstanceDeploy;
    } catch (error) {
      this.handleError(error, 'trigger deployment');
    }
  }

  // ============ SERVICES API ============

  /**
   * List services for a project
   * @param {string} accessToken - Railway access token
   * @param {string} projectId - Project ID
   * @returns {Array} Services
   */
  async listServices(accessToken, projectId) {
    try {
      const query = `
        query($projectId: String!) {
          project(id: $projectId) {
            id
            services {
              edges {
                node {
                  id
                  name
                  icon
                  createdAt
                  updatedAt
                }
              }
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { projectId });
      return data.project.services.edges.map(edge => edge.node);
    } catch (error) {
      this.handleError(error, 'list services');
    }
  }

  /**
   * Get a single service
   * @param {string} accessToken - Railway access token
   * @param {string} serviceId - Service ID
   * @returns {Object} Service details
   */
  async getService(accessToken, serviceId) {
    try {
      const query = `
        query($serviceId: String!) {
          service(id: $serviceId) {
            id
            name
            icon
            createdAt
            updatedAt
            deployments(first: 5) {
              edges {
                node {
                  id
                  status
                  createdAt
                }
              }
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { serviceId });
      return {
        ...data.service,
        recentDeployments: data.service.deployments.edges.map(edge => edge.node)
      };
    } catch (error) {
      this.handleError(error, 'get service');
    }
  }

  /**
   * Create a new service
   * @param {string} accessToken - Railway access token
   * @param {Object} serviceData - Service configuration
   * @param {string} serviceData.projectId
   * @param {string} serviceData.name
   * @param {{ repo: string }} [serviceData.source] - Link a GitHub repo at
   *   creation time (App Kit: source: { repo: "owner/repo" }), per Railway's
   *   documented `ServiceSourceInput`. `source` is a nullable GraphQL
   *   variable, so omitting it (undefined) is equivalent to not passing it.
   * @returns {Object} Created service
   */
  async createService(accessToken, serviceData) {
    try {
      const query = `
        mutation($projectId: String!, $name: String!, $source: ServiceSourceInput) {
          serviceCreate(input: {
            projectId: $projectId
            name: $name
            source: $source
          }) {
            id
            name
            createdAt
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, serviceData);
      return data.serviceCreate;
    } catch (error) {
      this.handleError(error, 'create service');
    }
  }

  /**
   * Delete a service
   * @param {string} accessToken - Railway access token
   * @param {string} serviceId - Service ID
   * @returns {boolean} Success
   */
  async deleteService(accessToken, serviceId) {
    try {
      const query = `
        mutation($serviceId: String!) {
          serviceDelete(id: $serviceId)
        }
      `;

      await this.executeQuery(accessToken, query, { serviceId });
      return true;
    } catch (error) {
      this.handleError(error, 'delete service');
    }
  }

  // ============ ENVIRONMENT VARIABLES API ============

  /**
   * List environment variables for a service
   * @param {string} accessToken - Railway access token
   * @param {string} serviceId - Service ID
   * @returns {Array} Environment variables
   */
  async listEnvironmentVariables(accessToken, serviceId) {
    try {
      const query = `
        query($serviceId: String!) {
          service(id: $serviceId) {
            id
            variables
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { serviceId });

      // Railway returns variables as a JSON object
      const variables = data.service.variables || {};
      return Object.entries(variables).map(([key, value]) => ({
        key,
        value
      }));
    } catch (error) {
      this.handleError(error, 'list environment variables');
    }
  }

  /**
   * Set environment variables for a service
   * @param {string} accessToken - Railway access token
   * @param {string} serviceId - Service ID
   * @param {Object} variables - Environment variables (key-value pairs)
   * @returns {boolean} Success
   */
  async setEnvironmentVariables(accessToken, serviceId, variables) {
    try {
      const query = `
        mutation($serviceId: String!, $variables: ServiceVariables!) {
          variableCollectionUpsert(input: {
            serviceId: $serviceId
            variables: $variables
          })
        }
      `;

      await this.executeQuery(accessToken, query, { serviceId, variables });
      return true;
    } catch (error) {
      this.handleError(error, 'set environment variables');
    }
  }

  // ============ LOGS API ============

  /**
   * Get deployment logs
   * @param {string} accessToken - Railway access token
   * @param {string} deploymentId - Deployment ID
   * @param {Object} options - Query options (limit)
   * @returns {Object} Logs
   */
  async getDeploymentLogs(accessToken, deploymentId, options = {}) {
    try {
      const query = `
        query($deploymentId: String!) {
          deployment(id: $deploymentId) {
            id
            buildLogs
            deployLogs
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { deploymentId });
      return {
        buildLogs: data.deployment.buildLogs || '',
        deployLogs: data.deployment.deployLogs || ''
      };
    } catch (error) {
      this.handleError(error, 'get deployment logs');
    }
  }

  // ============ TEAM API ============

  /**
   * Get team information
   * @param {string} accessToken - Railway access token
   * @param {string} teamId - Team ID
   * @returns {Object} Team details
   */
  async getTeam(accessToken, teamId) {
    try {
      const query = `
        query($teamId: String!) {
          team(id: $teamId) {
            id
            name
            avatar
            createdAt
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { teamId });
      return data.team;
    } catch (error) {
      this.handleError(error, 'get team');
    }
  }

  /**
   * List user teams
   * @param {string} accessToken - Railway access token
   * @returns {Array} Teams
   */
  async listTeams(accessToken) {
    try {
      const query = `
        query {
          me {
            teams {
              edges {
                node {
                  id
                  name
                  avatar
                  createdAt
                }
              }
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query);
      return data.me.teams.edges.map(edge => edge.node);
    } catch (error) {
      this.handleError(error, 'list teams');
    }
  }
}

module.exports = new RailwayApiService();
