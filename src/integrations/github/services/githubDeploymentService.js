const { Octokit } = require('@octokit/rest');
const githubAuthService = require('./githubAuthService');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class GitHubDeploymentService {
  /**
   * Get Octokit instance with user's access token
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {Octokit} Authenticated Octokit instance
   */
  async getOctokit(userId, organizationId) {
    const accessToken = await githubAuthService.getAccessToken(userId, organizationId);
    return new Octokit({ auth: accessToken });
  }

  /**
   * List deployments for a repository
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - List options
   * @returns {Array} List of deployments
   */
  async listDeployments(userId, organizationId, owner, repo, options = {}) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = { owner, repo };
      if (options.ref) params.ref = options.ref;
      if (options.task) params.task = options.task;
      if (options.environment) params.environment = options.environment;
      if (options.perPage) params.per_page = options.perPage;
      if (options.page) params.page = options.page;

      const response = await octokit.repos.listDeployments(params);

      return response.data.map(deployment => ({
        id: deployment.id,
        nodeId: deployment.node_id,
        sha: deployment.sha,
        ref: deployment.ref,
        task: deployment.task,
        environment: deployment.environment,
        description: deployment.description,
        creator: {
          login: deployment.creator.login,
          avatarUrl: deployment.creator.avatar_url
        },
        createdAt: deployment.created_at,
        updatedAt: deployment.updated_at,
        statusesUrl: deployment.statuses_url,
        repositoryUrl: deployment.repository_url
      }));
    } catch (error) {
      logger.error('Failed to list GitHub deployments:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list deployments',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create a deployment
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} deploymentData - Deployment data
   * @returns {Object} Created deployment
   */
  async createDeployment(userId, organizationId, owner, repo, deploymentData) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        owner,
        repo,
        ref: deploymentData.ref // branch, tag, or commit SHA
      };

      if (deploymentData.task) params.task = deploymentData.task;
      if (deploymentData.autoMerge !== undefined) params.auto_merge = deploymentData.autoMerge;
      if (deploymentData.requiredContexts) params.required_contexts = deploymentData.requiredContexts;
      if (deploymentData.payload) params.payload = deploymentData.payload;
      if (deploymentData.environment) params.environment = deploymentData.environment;
      if (deploymentData.description) params.description = deploymentData.description;
      if (deploymentData.transientEnvironment !== undefined) {
        params.transient_environment = deploymentData.transientEnvironment;
      }
      if (deploymentData.productionEnvironment !== undefined) {
        params.production_environment = deploymentData.productionEnvironment;
      }

      const response = await octokit.repos.createDeployment(params);

      logger.info(`GitHub deployment created: ${owner}/${repo} (${deploymentData.ref})`);

      return {
        id: response.data.id,
        nodeId: response.data.node_id,
        sha: response.data.sha,
        ref: response.data.ref,
        task: response.data.task,
        environment: response.data.environment,
        description: response.data.description,
        createdAt: response.data.created_at,
        statusesUrl: response.data.statuses_url
      };
    } catch (error) {
      logger.error('Failed to create GitHub deployment:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create deployment',
        error.response?.status || 500
      );
    }
  }

  /**
   * List deployment statuses
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} deploymentId - Deployment ID
   * @returns {Array} List of deployment statuses
   */
  async listDeploymentStatuses(userId, organizationId, owner, repo, deploymentId) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const response = await octokit.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: deploymentId
      });

      return response.data.map(status => ({
        id: status.id,
        state: status.state, // 'error', 'failure', 'inactive', 'pending', 'success', 'queued', 'in_progress'
        creator: {
          login: status.creator.login,
          avatarUrl: status.creator.avatar_url
        },
        description: status.description,
        environment: status.environment,
        targetUrl: status.target_url,
        createdAt: status.created_at,
        updatedAt: status.updated_at
      }));
    } catch (error) {
      logger.error('Failed to list GitHub deployment statuses:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list deployment statuses',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create a deployment status
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} deploymentId - Deployment ID
   * @param {Object} statusData - Status data
   * @returns {Object} Created status
   */
  async createDeploymentStatus(userId, organizationId, owner, repo, deploymentId, statusData) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        owner,
        repo,
        deployment_id: deploymentId,
        state: statusData.state // 'error', 'failure', 'inactive', 'pending', 'success', 'queued', 'in_progress'
      };

      if (statusData.targetUrl) params.target_url = statusData.targetUrl;
      if (statusData.logUrl) params.log_url = statusData.logUrl;
      if (statusData.description) params.description = statusData.description;
      if (statusData.environment) params.environment = statusData.environment;
      if (statusData.environmentUrl) params.environment_url = statusData.environmentUrl;
      if (statusData.autoInactive !== undefined) params.auto_inactive = statusData.autoInactive;

      const response = await octokit.repos.createDeploymentStatus(params);

      logger.info(`GitHub deployment status created: ${owner}/${repo} (${deploymentId}) - ${statusData.state}`);

      return {
        id: response.data.id,
        state: response.data.state,
        description: response.data.description,
        environment: response.data.environment,
        targetUrl: response.data.target_url,
        environmentUrl: response.data.environment_url,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('Failed to create GitHub deployment status:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create deployment status',
        error.response?.status || 500
      );
    }
  }

  /**
   * List workflow runs for a repository
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - List options
   * @returns {Object} Workflow runs data
   */
  async listWorkflowRuns(userId, organizationId, owner, repo, options = {}) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = { owner, repo };
      if (options.branch) params.branch = options.branch;
      if (options.event) params.event = options.event;
      if (options.status) params.status = options.status;
      if (options.perPage) params.per_page = options.perPage;
      if (options.page) params.page = options.page;

      const response = await octokit.actions.listWorkflowRunsForRepo(params);

      return {
        totalCount: response.data.total_count,
        workflowRuns: response.data.workflow_runs.map(run => ({
          id: run.id,
          name: run.name,
          headBranch: run.head_branch,
          headSha: run.head_sha,
          runNumber: run.run_number,
          event: run.event,
          status: run.status,
          conclusion: run.conclusion,
          workflowId: run.workflow_id,
          url: run.html_url,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          runStartedAt: run.run_started_at
        }))
      };
    } catch (error) {
      logger.error('Failed to list GitHub workflow runs:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list workflow runs',
        error.response?.status || 500
      );
    }
  }
}

module.exports = new GitHubDeploymentService();
