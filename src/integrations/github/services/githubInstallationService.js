const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const GitHubConnection = require('../models/GitHubConnection');
const config = require('../../../config');
const encryption = require('../../../utils/encryption');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

/**
 * GitHub Installation Service
 * Manages GitHub App installations, repository monitoring, and token lifecycle
 *
 * Migrated from monolith GitHubIntegrationService with multi-tenant support
 *
 * Features:
 * - Multi-tenant GitHub App installation management
 * - OAuth flow handling and token refresh
 * - Repository access and monitoring configuration
 * - Health checks with automatic failure tracking
 * - Backward compatibility with companyId-based installations
 */
class GitHubInstallationService {
  constructor() {
    this.appId = config.GITHUB_APP_ID;
    this.privateKey = config.GITHUB_APP_PRIVATE_KEY;
    this.clientId = config.GITHUB_CLIENT_ID;
    this.clientSecret = config.GITHUB_CLIENT_SECRET;
    this.installationUrl = config.GITHUB_APP_INSTALLATION_URL;
  }

  /**
   * Get GitHub App Octokit instance (for installation management)
   * @returns {Octokit} GitHub App authenticated client
   */
  getAppClient() {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.appId,
        privateKey: this.privateKey
      }
    });
  }

  /**
   * Get installation access token from GitHub
   * @param {number} installationId - GitHub installation ID
   * @returns {Promise<string>} Installation access token
   */
  async getInstallationToken(installationId) {
    try {
      const appClient = this.getAppClient();
      const { data } = await appClient.apps.createInstallationAccessToken({
        installation_id: installationId
      });
      return data.token;
    } catch (error) {
      logger.error('Failed to get installation token:', error);
      throw new AppError('Failed to get installation token', 500);
    }
  }

  /**
   * Create installation client with token
   * @param {string} token - Installation access token
   * @returns {Octokit} Installation authenticated client
   */
  createInstallationClient(token) {
    return new Octokit({ auth: token });
  }

  /**
   * Generate GitHub App installation URL
   * Creates OAuth flow URL with encoded state containing userId, organizationId, and timestamp
   *
   * @param {Object} params - Installation parameters
   * @param {string} params.userId - User ID for multi-tenant isolation
   * @param {string} params.organizationId - Organization ID for multi-tenant isolation
   * @param {string} params.companyId - Company ID for backward compatibility (optional)
   * @returns {string} GitHub installation URL
   */
  generateInstallationUrl({ userId, organizationId, companyId }) {
    try {
      if (!userId || !organizationId) {
        throw new Error('userId and organizationId are required to generate installation URL');
      }

      // Encode state parameter with userId, organizationId, companyId (compat), and timestamp
      const state = Buffer.from(JSON.stringify({
        userId: userId.toString(),
        organizationId: organizationId.toString(),
        companyId: companyId ? companyId.toString() : null,
        timestamp: Date.now()
      })).toString('base64');

      const url = `${this.installationUrl}/installations/new?state=${state}`;

      logger.info('Generated GitHub installation URL', {
        userId: userId.toString(),
        organizationId: organizationId.toString()
      });

      return url;
    } catch (error) {
      logger.error('Failed to generate installation URL', {
        error: error.message,
        userId: userId?.toString(),
        organizationId: organizationId?.toString()
      });
      throw error;
    }
  }

  /**
   * Handle installation callback from GitHub OAuth flow
   * Validates state, exchanges code for token, and creates GitHubConnection record
   *
   * @param {Object} params - Callback parameters
   * @param {string} params.code - OAuth authorization code from GitHub
   * @param {string} params.installationId - GitHub installation ID
   * @param {string} params.state - Base64-encoded state parameter
   * @returns {Promise<GitHubConnection>} Created installation record
   */
  async handleInstallationCallback({ code, installationId, state }) {
    try {
      if (!code || !installationId || !state) {
        throw new Error('Missing required parameters for installation callback');
      }

      // Decode and validate state parameter
      let stateData;
      try {
        stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      } catch (error) {
        throw new Error('Invalid state parameter: failed to decode');
      }

      const { userId, organizationId, companyId } = stateData;

      if (!userId || !organizationId) {
        throw new Error('State missing userId or organizationId');
      }

      // Get installation access token from GitHub
      const token = await this.getInstallationToken(parseInt(installationId));

      // Fetch installation details
      const client = this.createInstallationClient(token);
      const { data: installationData } = await client.rest.apps.getInstallation({
        installation_id: parseInt(installationId)
      });

      // Fetch accessible repositories
      const { data: reposData } = await client.rest.apps.listReposAccessibleToInstallation();

      // Map repositories to schema format
      const accessibleRepositories = (reposData.repositories || []).map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        htmlUrl: repo.html_url,
        language: repo.language,
        size: repo.size,
        updatedAt: repo.updated_at
      }));

      // Calculate token expiry (GitHub tokens expire in 1 hour)
      const tokenExpiry = new Date(Date.now() + 3600000);

      // Encrypt the access token
      const encryptedToken = encryption.encrypt(token);

      // Check if installation already exists
      let connection = await GitHubConnection.findOne({ installationId: installationId.toString() });

      if (connection) {
        // Update existing installation
        connection.userId = userId;
        connection.organizationId = organizationId;
        connection.companyId = companyId || null;
        connection.installedBy = userId;
        connection.accountType = installationData.account.type;
        connection.accountLogin = installationData.account.login;
        connection.accountId = installationData.account.id;
        connection.githubUserId = String(installationData.account.id);
        connection.githubUsername = installationData.account.login;
        connection.accessToken = encryptedToken;
        connection.tokenExpiry = tokenExpiry;
        connection.expiresAt = tokenExpiry;
        connection.repositorySelection = reposData.repository_selection || 'selected';
        connection.accessibleRepositories = accessibleRepositories;
        connection.status = 'active';
        connection.installedAt = new Date();
        connection.lastSyncedAt = new Date();
      } else {
        // Create new installation record
        connection = new GitHubConnection({
          userId,
          organizationId,
          companyId: companyId || null,
          installedBy: userId,
          installationId: installationId.toString(),
          accountType: installationData.account.type,
          accountLogin: installationData.account.login,
          accountId: installationData.account.id,
          githubUserId: String(installationData.account.id),
          githubUsername: installationData.account.login,
          accessToken: encryptedToken,
          tokenExpiry,
          expiresAt: tokenExpiry,
          repositorySelection: reposData.repository_selection || 'selected',
          accessibleRepositories,
          monitoredRepositories: [],
          status: 'active',
          installedAt: new Date(),
          lastSyncedAt: new Date(),
          webhookEvents: ['push', 'pull_request', 'deployment', 'deployment_status', 'release', 'repository']
        });
      }

      await connection.save();

      logger.info('GitHub installation created/updated successfully', {
        installationId: connection.installationId,
        userId: userId.toString(),
        organizationId: organizationId.toString(),
        accountLogin: connection.accountLogin,
        repoCount: accessibleRepositories.length
      });

      return connection;
    } catch (error) {
      logger.error('Failed to handle installation callback', {
        error: error.message,
        installationId
      });
      throw new AppError(`Installation callback failed: ${error.message}`, 500);
    }
  }

  /**
   * Get valid installation access token (refresh if expired)
   * Returns decrypted token or fetches new token from GitHub if expired
   *
   * @param {string} installationId - GitHub installation ID
   * @param {Object} filters - Query filters (userId, organizationId, or companyId)
   * @returns {Promise<string>} Valid access token
   */
  async getValidToken(installationId, filters = {}) {
    try {
      if (!installationId) {
        throw new Error('Installation ID is required');
      }

      // Build query with multi-tenant filtering
      const query = { installationId };
      if (filters.userId && filters.organizationId) {
        query.userId = filters.userId;
        query.organizationId = filters.organizationId;
      } else if (filters.companyId) {
        query.companyId = filters.companyId;
      }

      // Find installation with multi-tenant filtering
      // Need to select accessToken explicitly since it's excluded by default
      const installation = await GitHubConnection.findOne(query).select('+accessToken');

      if (!installation) {
        throw new AppError(`GitHub installation ${installationId} not found`, 404);
      }

      // Check if token is expired
      if (installation.isTokenExpired()) {
        logger.info('Token expired, refreshing...', {
          installationId,
          userId: installation.userId?.toString(),
          organizationId: installation.organizationId?.toString()
        });

        // Fetch new token from GitHub
        const newToken = await this.getInstallationToken(parseInt(installationId));

        // Update installation with new token and expiry
        const newExpiry = new Date(Date.now() + 3600000);
        installation.tokenExpiry = newExpiry;
        installation.expiresAt = newExpiry;
        installation.accessToken = encryption.encrypt(newToken);
        await installation.save();

        logger.info('Token refreshed successfully', {
          installationId
        });

        return newToken;
      }

      // Return decrypted token
      return encryption.decrypt(installation.accessToken);
    } catch (error) {
      logger.error('Failed to get valid token', {
        error: error.message,
        installationId
      });
      throw error;
    }
  }

  /**
   * Fetch accessible repositories for installation
   * Queries GitHub API for current repository access
   *
   * @param {string} installationId - GitHub installation ID
   * @param {Object} filters - Query filters (userId, organizationId, or companyId)
   * @returns {Promise<Array>} List of accessible repositories
   */
  async fetchRepositories(installationId, filters = {}) {
    try {
      if (!installationId) {
        throw new Error('Installation ID is required');
      }

      // Get valid access token
      const token = await this.getValidToken(installationId, filters);

      // Create GitHub client with installation token
      const client = this.createInstallationClient(token);

      // Fetch accessible repositories
      const { data: reposData } = await client.rest.apps.listReposAccessibleToInstallation();

      // Map to consistent format
      const repositories = (reposData.repositories || []).map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        htmlUrl: repo.html_url,
        language: repo.language,
        size: repo.size,
        updatedAt: repo.updated_at
      }));

      logger.info('Fetched repositories from GitHub', {
        installationId,
        count: repositories.length
      });

      return repositories;
    } catch (error) {
      logger.error('Failed to fetch repositories', {
        error: error.message,
        installationId
      });
      throw new AppError(`GitHub API error: ${error.message}`, 500);
    }
  }

  /**
   * Sync installation with GitHub (refresh repos, validate token)
   * Updates accessibleRepositories list and lastSyncAt timestamp
   *
   * @param {string} installationId - GitHub installation ID
   * @param {Object} filters - Query filters (userId, organizationId, or companyId)
   * @returns {Promise<GitHubConnection>} Updated installation
   */
  async syncInstallation(installationId, filters = {}) {
    try {
      if (!installationId) {
        throw new Error('Installation ID is required');
      }

      // Build query with multi-tenant filtering
      const query = { installationId };
      if (filters.userId && filters.organizationId) {
        query.userId = filters.userId;
        query.organizationId = filters.organizationId;
      } else if (filters.companyId) {
        query.companyId = filters.companyId;
      }

      // Find installation with multi-tenant filtering
      const installation = await GitHubConnection.findOne(query);

      if (!installation) {
        throw new AppError(`GitHub installation ${installationId} not found`, 404);
      }

      // Fetch current repository list from GitHub
      const repositories = await this.fetchRepositories(installationId, filters);

      // Update installation
      installation.accessibleRepositories = repositories;
      installation.lastSyncAt = new Date();
      installation.lastSyncedAt = new Date();
      installation.metrics = installation.metrics || {};
      installation.metrics.totalReposIndexed = repositories.length;

      await installation.save();

      logger.info('Installation synced successfully', {
        installationId,
        repoCount: repositories.length
      });

      return installation;
    } catch (error) {
      logger.error('Failed to sync installation', {
        error: error.message,
        installationId
      });
      throw error;
    }
  }

  /**
   * Get all installations for a user/organization or company
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} List of installations
   */
  async getInstallations(filters = {}) {
    try {
      const query = {};

      if (filters.userId && filters.organizationId) {
        query.userId = filters.userId;
        query.organizationId = filters.organizationId;
      } else if (filters.companyId) {
        query.companyId = filters.companyId;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      const installations = await GitHubConnection.find(query)
        .sort({ createdAt: -1 });

      return installations;
    } catch (error) {
      logger.error('Failed to get installations', {
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Get specific installation by ID
   * @param {string} installationId - Installation ID
   * @param {Object} filters - Query filters
   * @returns {Promise<GitHubConnection>} Installation record
   */
  async getInstallation(installationId, filters = {}) {
    try {
      const query = { installationId };

      if (filters.userId && filters.organizationId) {
        query.userId = filters.userId;
        query.organizationId = filters.organizationId;
      } else if (filters.companyId) {
        query.companyId = filters.companyId;
      }

      const installation = await GitHubConnection.findOne(query);

      if (!installation) {
        throw new AppError(`GitHub installation ${installationId} not found`, 404);
      }

      return installation;
    } catch (error) {
      logger.error('Failed to get installation', {
        error: error.message,
        installationId
      });
      throw error;
    }
  }

  /**
   * Delete (uninstall) GitHub installation
   * @param {string} installationId - Installation ID
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} Deletion result
   */
  async deleteInstallation(installationId, filters = {}) {
    try {
      const query = { installationId };

      if (filters.userId && filters.organizationId) {
        query.userId = filters.userId;
        query.organizationId = filters.organizationId;
      } else if (filters.companyId) {
        query.companyId = filters.companyId;
      }

      const installation = await GitHubConnection.findOne(query);

      if (!installation) {
        throw new AppError(`GitHub installation ${installationId} not found`, 404);
      }

      // Mark as uninstalled instead of deleting
      installation.status = 'uninstalled';
      installation.uninstalledAt = new Date();
      await installation.save();

      logger.info('Installation marked as uninstalled', {
        installationId,
        userId: installation.userId?.toString(),
        organizationId: installation.organizationId?.toString()
      });

      return { message: 'Installation uninstalled successfully' };
    } catch (error) {
      logger.error('Failed to delete installation', {
        error: error.message,
        installationId
      });
      throw error;
    }
  }

  /**
   * Handle installation deletion webhook (from GitHub)
   * @param {string} installationId - GitHub installation ID
   * @returns {Promise<GitHubConnection>} Updated installation
   */
  async handleInstallationDeleted(installationId) {
    try {
      if (!installationId) {
        throw new Error('Installation ID is required');
      }

      // Find installation (no multi-tenant filtering for webhook events)
      const installation = await GitHubConnection.findOne({ installationId });

      if (!installation) {
        logger.warn(`GitHub installation ${installationId} not found for deletion webhook`);
        return null;
      }

      // Update status to uninstalled
      installation.status = 'uninstalled';
      installation.uninstalledAt = new Date();

      await installation.save();

      logger.info('Installation marked as uninstalled via webhook', {
        installationId,
        userId: installation.userId?.toString()
      });

      return installation;
    } catch (error) {
      logger.error('Failed to handle installation deletion', {
        error: error.message,
        installationId
      });
      throw error;
    }
  }

  /**
   * Health check for installation
   * Verifies GitHub API connectivity and updates health metrics
   * Auto-suspends after 5 consecutive failures
   *
   * @param {string} installationId - GitHub installation ID
   * @param {Object} filters - Query filters
   * @returns {Promise<GitHubConnection>} Updated installation with health status
   */
  async performHealthCheck(installationId, filters = {}) {
    try {
      if (!installationId) {
        throw new Error('Installation ID is required');
      }

      const installation = await this.getInstallation(installationId, filters);

      try {
        // Attempt to get installation token (this validates API access)
        const token = await this.getValidToken(installationId, filters);

        // Verify installation exists on GitHub
        const client = this.createInstallationClient(token);
        await client.rest.apps.getInstallation({
          installation_id: parseInt(installationId)
        });

        // Health check passed - reset failure count
        installation.health = {
          lastCheck: new Date(),
          consecutiveFailures: 0,
          errorMessage: null
        };

        logger.info('Health check passed', {
          installationId
        });
      } catch (error) {
        // Health check failed - increment failure count
        const consecutiveFailures = (installation.health?.consecutiveFailures || 0) + 1;

        installation.health = {
          lastCheck: new Date(),
          consecutiveFailures,
          errorMessage: error.message
        };

        logger.warn('Health check failed', {
          installationId,
          consecutiveFailures,
          error: error.message
        });

        // Auto-suspend after 5 consecutive failures
        if (consecutiveFailures >= 5) {
          installation.status = 'suspended';
          installation.suspendedAt = new Date();

          logger.error('Installation auto-suspended after 5 health check failures', {
            installationId
          });
        }
      }

      await installation.save();

      return installation;
    } catch (error) {
      logger.error('Failed to perform health check', {
        error: error.message,
        installationId
      });
      throw error;
    }
  }
}

module.exports = new GitHubInstallationService();
