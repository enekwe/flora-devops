const { Octokit } = require('@octokit/rest');
const githubAuthService = require('./githubAuthService');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class GitHubIssueService {
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
   * List repository issues
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - List options
   * @returns {Array} List of issues
   */
  async listIssues(userId, organizationId, owner, repo, options = {}) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = { owner, repo };
      if (options.state) params.state = options.state; // 'open', 'closed', 'all'
      if (options.assignee) params.assignee = options.assignee;
      if (options.creator) params.creator = options.creator;
      if (options.labels) params.labels = options.labels;
      if (options.sort) params.sort = options.sort; // 'created', 'updated', 'comments'
      if (options.direction) params.direction = options.direction; // 'asc', 'desc'
      if (options.since) params.since = options.since;
      if (options.perPage) params.per_page = options.perPage;
      if (options.page) params.page = options.page;

      const response = await octokit.issues.listForRepo(params);

      return response.data
        .filter(issue => !issue.pull_request) // Filter out pull requests
        .map(issue => ({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          user: {
            login: issue.user.login,
            avatarUrl: issue.user.avatar_url
          },
          assignees: issue.assignees.map(a => ({
            login: a.login,
            avatarUrl: a.avatar_url
          })),
          labels: issue.labels.map(l => ({
            name: l.name,
            color: l.color,
            description: l.description
          })),
          milestone: issue.milestone ? {
            title: issue.milestone.title,
            number: issue.milestone.number,
            state: issue.milestone.state
          } : null,
          commentsCount: issue.comments,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          closedAt: issue.closed_at,
          url: issue.html_url
        }));
    } catch (error) {
      logger.error('Failed to list GitHub issues:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list issues',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get issue details
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} issueNumber - Issue number
   * @returns {Object} Issue details
   */
  async getIssue(userId, organizationId, owner, repo, issueNumber) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);
      const response = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber
      });

      const issue = response.data;

      return {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        user: {
          login: issue.user.login,
          avatarUrl: issue.user.avatar_url
        },
        assignees: issue.assignees.map(a => ({
          login: a.login,
          avatarUrl: a.avatar_url
        })),
        labels: issue.labels.map(l => ({
          name: l.name,
          color: l.color,
          description: l.description
        })),
        milestone: issue.milestone ? {
          title: issue.milestone.title,
          number: issue.milestone.number,
          state: issue.milestone.state
        } : null,
        commentsCount: issue.comments,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at,
        url: issue.html_url
      };
    } catch (error) {
      logger.error('Failed to get GitHub issue:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to get issue',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create a new issue
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} issueData - Issue data
   * @returns {Object} Created issue
   */
  async createIssue(userId, organizationId, owner, repo, issueData) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        owner,
        repo,
        title: issueData.title,
        body: issueData.body || ''
      };

      if (issueData.assignees && issueData.assignees.length > 0) {
        params.assignees = issueData.assignees;
      }

      if (issueData.labels && issueData.labels.length > 0) {
        params.labels = issueData.labels;
      }

      if (issueData.milestone) {
        params.milestone = issueData.milestone;
      }

      const response = await octokit.issues.create(params);

      logger.info(`GitHub issue created: ${owner}/${repo}#${response.data.number}`);

      return {
        id: response.data.id,
        number: response.data.number,
        title: response.data.title,
        body: response.data.body,
        state: response.data.state,
        url: response.data.html_url,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('Failed to create GitHub issue:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create issue',
        error.response?.status || 500
      );
    }
  }

  /**
   * Update an issue
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} issueNumber - Issue number
   * @param {Object} updates - Issue updates
   * @returns {Object} Updated issue
   */
  async updateIssue(userId, organizationId, owner, repo, issueNumber, updates) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        owner,
        repo,
        issue_number: issueNumber
      };

      if (updates.title) params.title = updates.title;
      if (updates.body !== undefined) params.body = updates.body;
      if (updates.state) params.state = updates.state; // 'open' or 'closed'
      if (updates.assignees) params.assignees = updates.assignees;
      if (updates.labels) params.labels = updates.labels;
      if (updates.milestone !== undefined) params.milestone = updates.milestone;

      const response = await octokit.issues.update(params);

      logger.info(`GitHub issue updated: ${owner}/${repo}#${issueNumber}`);

      return {
        id: response.data.id,
        number: response.data.number,
        title: response.data.title,
        body: response.data.body,
        state: response.data.state,
        url: response.data.html_url,
        updatedAt: response.data.updated_at
      };
    } catch (error) {
      logger.error('Failed to update GitHub issue:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to update issue',
        error.response?.status || 500
      );
    }
  }

  /**
   * Add a comment to an issue
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} issueNumber - Issue number
   * @param {string} body - Comment body
   * @returns {Object} Created comment
   */
  async createComment(userId, organizationId, owner, repo, issueNumber, body) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const response = await octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body
      });

      logger.info(`GitHub issue comment created: ${owner}/${repo}#${issueNumber}`);

      return {
        id: response.data.id,
        body: response.data.body,
        user: {
          login: response.data.user.login,
          avatarUrl: response.data.user.avatar_url
        },
        createdAt: response.data.created_at,
        url: response.data.html_url
      };
    } catch (error) {
      logger.error('Failed to create GitHub issue comment:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create comment',
        error.response?.status || 500
      );
    }
  }

  /**
   * List issue comments
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} issueNumber - Issue number
   * @returns {Array} List of comments
   */
  async listComments(userId, organizationId, owner, repo, issueNumber) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const response = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber
      });

      return response.data.map(comment => ({
        id: comment.id,
        body: comment.body,
        user: {
          login: comment.user.login,
          avatarUrl: comment.user.avatar_url
        },
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        url: comment.html_url
      }));
    } catch (error) {
      logger.error('Failed to list GitHub issue comments:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list comments',
        error.response?.status || 500
      );
    }
  }
}

module.exports = new GitHubIssueService();
