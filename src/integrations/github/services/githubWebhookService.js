const crypto = require('crypto');
const { Octokit } = require('@octokit/rest');
const githubAuthService = require('./githubAuthService');
const GitHubConnection = require('../models/GitHubConnection');
const config = require('../../../config');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class GitHubWebhookService {
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
   * Create a webhook for a repository
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} webhookData - Webhook configuration
   * @returns {Object} Created webhook
   */
  async createWebhook(userId, organizationId, owner, repo, webhookData) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        owner,
        repo,
        name: 'web',
        config: {
          url: webhookData.url,
          content_type: 'json',
          secret: webhookData.secret || config.GITHUB_WEBHOOK_SECRET,
          insecure_ssl: '0'
        },
        events: webhookData.events || ['push', 'pull_request', 'issues'],
        active: webhookData.active !== undefined ? webhookData.active : true
      };

      const response = await octokit.repos.createWebhook(params);

      // Update connection with webhook info
      const connection = await GitHubConnection.findOne({ userId, organizationId });
      if (connection) {
        const repoData = await octokit.repos.get({ owner, repo });
        connection.updateRepositoryWebhook(
          repoData.data.id,
          response.data.id,
          response.data.active
        );
        await connection.save();
      }

      logger.info(`GitHub webhook created: ${owner}/${repo}`);

      return {
        id: response.data.id,
        name: response.data.name,
        active: response.data.active,
        events: response.data.events,
        config: {
          url: response.data.config.url,
          contentType: response.data.config.content_type
        },
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at
      };
    } catch (error) {
      logger.error('Failed to create GitHub webhook:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create webhook',
        error.response?.status || 500
      );
    }
  }

  /**
   * List webhooks for a repository
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Array} List of webhooks
   */
  async listWebhooks(userId, organizationId, owner, repo) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const response = await octokit.repos.listWebhooks({ owner, repo });

      return response.data.map(webhook => ({
        id: webhook.id,
        name: webhook.name,
        active: webhook.active,
        events: webhook.events,
        config: {
          url: webhook.config.url,
          contentType: webhook.config.content_type
        },
        createdAt: webhook.created_at,
        updatedAt: webhook.updated_at
      }));
    } catch (error) {
      logger.error('Failed to list GitHub webhooks:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list webhooks',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get webhook details
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} hookId - Webhook ID
   * @returns {Object} Webhook details
   */
  async getWebhook(userId, organizationId, owner, repo, hookId) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const response = await octokit.repos.getWebhook({
        owner,
        repo,
        hook_id: hookId
      });

      return {
        id: response.data.id,
        name: response.data.name,
        active: response.data.active,
        events: response.data.events,
        config: {
          url: response.data.config.url,
          contentType: response.data.config.content_type
        },
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at,
        lastResponse: response.data.last_response
      };
    } catch (error) {
      logger.error('Failed to get GitHub webhook:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to get webhook',
        error.response?.status || 500
      );
    }
  }

  /**
   * Update a webhook
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} hookId - Webhook ID
   * @param {Object} updates - Webhook updates
   * @returns {Object} Updated webhook
   */
  async updateWebhook(userId, organizationId, owner, repo, hookId, updates) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        owner,
        repo,
        hook_id: hookId
      };

      if (updates.config) {
        params.config = {};
        if (updates.config.url) params.config.url = updates.config.url;
        if (updates.config.secret) params.config.secret = updates.config.secret;
        if (updates.config.contentType) params.config.content_type = updates.config.contentType;
      }

      if (updates.events) params.events = updates.events;
      if (updates.active !== undefined) params.active = updates.active;

      const response = await octokit.repos.updateWebhook(params);

      logger.info(`GitHub webhook updated: ${owner}/${repo} (${hookId})`);

      return {
        id: response.data.id,
        name: response.data.name,
        active: response.data.active,
        events: response.data.events,
        config: {
          url: response.data.config.url,
          contentType: response.data.config.content_type
        },
        updatedAt: response.data.updated_at
      };
    } catch (error) {
      logger.error('Failed to update GitHub webhook:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to update webhook',
        error.response?.status || 500
      );
    }
  }

  /**
   * Delete a webhook
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} hookId - Webhook ID
   */
  async deleteWebhook(userId, organizationId, owner, repo, hookId) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      await octokit.repos.deleteWebhook({
        owner,
        repo,
        hook_id: hookId
      });

      // Update connection
      const connection = await GitHubConnection.findOne({ userId, organizationId });
      if (connection) {
        const repoData = await octokit.repos.get({ owner, repo });
        connection.updateRepositoryWebhook(repoData.data.id, null, false);
        await connection.save();
      }

      logger.info(`GitHub webhook deleted: ${owner}/${repo} (${hookId})`);

      return { message: 'Webhook deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete GitHub webhook:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to delete webhook',
        error.response?.status || 500
      );
    }
  }

  /**
   * Verify webhook signature
   * @param {string} payload - Request payload
   * @param {string} signature - GitHub signature header
   * @param {string} secret - Webhook secret
   * @returns {boolean} Signature is valid
   */
  verifySignature(payload, signature, secret = config.GITHUB_WEBHOOK_SECRET) {
    if (!signature || !secret) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  }

  /**
   * Test webhook delivery
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} hookId - Webhook ID
   * @returns {Object} Test result
   */
  async testWebhook(userId, organizationId, owner, repo, hookId) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      await octokit.repos.testPushWebhook({
        owner,
        repo,
        hook_id: hookId
      });

      logger.info(`GitHub webhook test sent: ${owner}/${repo} (${hookId})`);

      return { message: 'Webhook test sent successfully' };
    } catch (error) {
      logger.error('Failed to test GitHub webhook:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to test webhook',
        error.response?.status || 500
      );
    }
  }
}

module.exports = new GitHubWebhookService();
