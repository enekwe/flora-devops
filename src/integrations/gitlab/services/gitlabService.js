const axios = require('axios');
const gitlabAuthService = require('./gitlabAuthService');
const GitLabConnection = require('../models/GitLabConnection');
const config = require('../../../config');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class GitLabService {
  constructor() {
    this.instanceUrl = config.GITLAB_INSTANCE_URL;
  }

  /**
   * Get GitLab API client with user's access token
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {Object} Axios instance configured for GitLab API
   */
  async getClient(userId, organizationId) {
    const accessToken = await gitlabAuthService.getAccessToken(userId, organizationId);
    return axios.create({
      baseURL: `${this.instanceUrl}/api/v4`,
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  }

  // === PROJECT MANAGEMENT ===

  /**
   * List user's projects
   */
  async listProjects(userId, organizationId, options = {}) {
    try {
      const client = await this.getClient(userId, organizationId);

      const params = {
        membership: true,
        per_page: options.perPage || 20,
        page: options.page || 1
      };

      if (options.visibility) params.visibility = options.visibility;
      if (options.orderBy) params.order_by = options.orderBy;
      if (options.sort) params.sort = options.sort;

      const response = await client.get('/projects', { params });

      // Update connection with projects
      const connection = await GitLabConnection.findOne({ userId, organizationId });
      if (connection) {
        response.data.forEach(project => connection.addProject(project));
        await connection.save();
      }

      return response.data.map(project => ({
        id: project.id,
        name: project.name,
        path: project.path,
        pathWithNamespace: project.path_with_namespace,
        description: project.description,
        visibility: project.visibility,
        webUrl: project.web_url,
        httpUrlToRepo: project.http_url_to_repo,
        sshUrlToRepo: project.ssh_url_to_repo,
        defaultBranch: project.default_branch,
        starCount: project.star_count,
        forksCount: project.forks_count,
        openIssuesCount: project.open_issues_count,
        createdAt: project.created_at,
        lastActivityAt: project.last_activity_at
      }));
    } catch (error) {
      logger.error('Failed to list GitLab projects:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list projects',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create a new project
   */
  async createProject(userId, organizationId, projectData) {
    try {
      const client = await this.getClient(userId, organizationId);

      const response = await client.post('/projects', {
        name: projectData.name,
        description: projectData.description || '',
        visibility: projectData.visibility || 'private',
        initialize_with_readme: projectData.initializeWithReadme || false
      });

      logger.info(`GitLab project created: ${response.data.path_with_namespace}`);

      return {
        id: response.data.id,
        name: response.data.name,
        pathWithNamespace: response.data.path_with_namespace,
        visibility: response.data.visibility,
        webUrl: response.data.web_url,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('Failed to create GitLab project:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create project',
        error.response?.status || 500
      );
    }
  }

  // === ISSUE MANAGEMENT ===

  /**
   * List project issues
   */
  async listIssues(userId, organizationId, projectId, options = {}) {
    try {
      const client = await this.getClient(userId, organizationId);

      const params = {
        per_page: options.perPage || 20,
        page: options.page || 1
      };

      if (options.state) params.state = options.state;
      if (options.labels) params.labels = options.labels;
      if (options.orderBy) params.order_by = options.orderBy;

      const response = await client.get(`/projects/${projectId}/issues`, { params });

      return response.data.map(issue => ({
        id: issue.id,
        iid: issue.iid,
        title: issue.title,
        description: issue.description,
        state: issue.state,
        author: {
          id: issue.author.id,
          username: issue.author.username,
          avatarUrl: issue.author.avatar_url
        },
        assignees: issue.assignees.map(a => ({
          id: a.id,
          username: a.username,
          avatarUrl: a.avatar_url
        })),
        labels: issue.labels,
        webUrl: issue.web_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at
      }));
    } catch (error) {
      logger.error('Failed to list GitLab issues:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list issues',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create an issue
   */
  async createIssue(userId, organizationId, projectId, issueData) {
    try {
      const client = await this.getClient(userId, organizationId);

      const response = await client.post(`/projects/${projectId}/issues`, {
        title: issueData.title,
        description: issueData.description || '',
        assignee_ids: issueData.assigneeIds || [],
        labels: issueData.labels || ''
      });

      logger.info(`GitLab issue created: ${projectId}#${response.data.iid}`);

      return {
        id: response.data.id,
        iid: response.data.iid,
        title: response.data.title,
        description: response.data.description,
        state: response.data.state,
        webUrl: response.data.web_url,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('Failed to create GitLab issue:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create issue',
        error.response?.status || 500
      );
    }
  }

  // === CI/CD PIPELINES ===

  /**
   * List project pipelines
   */
  async listPipelines(userId, organizationId, projectId, options = {}) {
    try {
      const client = await this.getClient(userId, organizationId);

      const params = {
        per_page: options.perPage || 20,
        page: options.page || 1
      };

      if (options.status) params.status = options.status;
      if (options.ref) params.ref = options.ref;

      const response = await client.get(`/projects/${projectId}/pipelines`, { params });

      return response.data.map(pipeline => ({
        id: pipeline.id,
        iid: pipeline.iid,
        projectId: pipeline.project_id,
        status: pipeline.status,
        ref: pipeline.ref,
        sha: pipeline.sha,
        webUrl: pipeline.web_url,
        createdAt: pipeline.created_at,
        updatedAt: pipeline.updated_at
      }));
    } catch (error) {
      logger.error('Failed to list GitLab pipelines:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list pipelines',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get pipeline details
   */
  async getPipeline(userId, organizationId, projectId, pipelineId) {
    try {
      const client = await this.getClient(userId, organizationId);

      const response = await client.get(`/projects/${projectId}/pipelines/${pipelineId}`);

      return {
        id: response.data.id,
        iid: response.data.iid,
        projectId: response.data.project_id,
        status: response.data.status,
        ref: response.data.ref,
        sha: response.data.sha,
        beforeSha: response.data.before_sha,
        tag: response.data.tag,
        yamlErrors: response.data.yaml_errors,
        user: {
          id: response.data.user.id,
          username: response.data.user.username,
          avatarUrl: response.data.user.avatar_url
        },
        duration: response.data.duration,
        coverage: response.data.coverage,
        webUrl: response.data.web_url,
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at,
        startedAt: response.data.started_at,
        finishedAt: response.data.finished_at
      };
    } catch (error) {
      logger.error('Failed to get GitLab pipeline:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to get pipeline',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create a new pipeline
   */
  async createPipeline(userId, organizationId, projectId, ref, variables = {}) {
    try {
      const client = await this.getClient(userId, organizationId);

      const response = await client.post(`/projects/${projectId}/pipeline`, {
        ref,
        variables: Object.entries(variables).map(([key, value]) => ({
          key,
          value,
          variable_type: 'env_var'
        }))
      });

      logger.info(`GitLab pipeline created: ${projectId}/${response.data.id}`);

      return {
        id: response.data.id,
        iid: response.data.iid,
        status: response.data.status,
        ref: response.data.ref,
        sha: response.data.sha,
        webUrl: response.data.web_url,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('Failed to create GitLab pipeline:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create pipeline',
        error.response?.status || 500
      );
    }
  }

  // === WEBHOOKS ===

  /**
   * Create a webhook for a project
   */
  async createWebhook(userId, organizationId, projectId, webhookData) {
    try {
      const client = await this.getClient(userId, organizationId);

      const response = await client.post(`/projects/${projectId}/hooks`, {
        url: webhookData.url,
        token: webhookData.secret || config.GITLAB_WEBHOOK_SECRET,
        push_events: webhookData.events?.includes('push') || true,
        issues_events: webhookData.events?.includes('issues') || false,
        merge_requests_events: webhookData.events?.includes('merge_requests') || false,
        wiki_page_events: webhookData.events?.includes('wiki_page') || false,
        pipeline_events: webhookData.events?.includes('pipeline') || false,
        enable_ssl_verification: true
      });

      // Update connection with webhook info
      const connection = await GitLabConnection.findOne({ userId, organizationId });
      if (connection) {
        connection.updateProjectWebhook(projectId, response.data.id, true);
        await connection.save();
      }

      logger.info(`GitLab webhook created for project ${projectId}`);

      return {
        id: response.data.id,
        url: response.data.url,
        pushEvents: response.data.push_events,
        issuesEvents: response.data.issues_events,
        mergeRequestsEvents: response.data.merge_requests_events,
        pipelineEvents: response.data.pipeline_events,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('Failed to create GitLab webhook:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create webhook',
        error.response?.status || 500
      );
    }
  }

  /**
   * List project webhooks
   */
  async listWebhooks(userId, organizationId, projectId) {
    try {
      const client = await this.getClient(userId, organizationId);

      const response = await client.get(`/projects/${projectId}/hooks`);

      return response.data.map(hook => ({
        id: hook.id,
        url: hook.url,
        pushEvents: hook.push_events,
        issuesEvents: hook.issues_events,
        mergeRequestsEvents: hook.merge_requests_events,
        pipelineEvents: hook.pipeline_events,
        createdAt: hook.created_at
      }));
    } catch (error) {
      logger.error('Failed to list GitLab webhooks:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list webhooks',
        error.response?.status || 500
      );
    }
  }
}

module.exports = new GitLabService();
