const GitHubConnection = require('../models/GitHubConnection');
const githubInstallationService = require('./githubInstallationService');
const logger = require('../../../config/logger');

/**
 * GitHub Event Service
 * Processes GitHub webhook events for repository monitoring
 *
 * Merged from monolith GitHubWebhookService with enhanced event handling
 *
 * Key responsibilities:
 * - Route webhook events to appropriate handlers
 * - Update metrics on webhook events
 * - Trigger re-indexing on push/PR merge events (integration point)
 * - Handle installation lifecycle events (created, deleted, suspend, unsuspend)
 * - Handle repository events (renamed, archived, deleted)
 * - Auto-resolve issues when problems are fixed
 *
 * Part of GitHub Integration multi-tenant framework
 */
class GitHubEventService {
  /**
   * Route webhook event to appropriate handler
   * @param {string} event - GitHub event type (push, pull_request, deployment, etc.)
   * @param {Object} payload - GitHub webhook payload
   * @returns {Promise<Object>} Processing result
   */
  async processWebhookEvent(event, payload) {
    logger.info('Processing GitHub webhook:', {
      event,
      repoId: payload.repository?.id,
      installationId: payload.installation?.id
    });

    const handlers = {
      push: this.handlePushEvent.bind(this),
      pull_request: this.handlePullRequestEvent.bind(this),
      deployment: this.handleDeploymentEvent.bind(this),
      deployment_status: this.handleDeploymentStatusEvent.bind(this),
      release: this.handleReleaseEvent.bind(this),
      repository: this.handleRepositoryEvent.bind(this),
      installation: this.handleInstallationEvent.bind(this),
      installation_repositories: this.handleInstallationRepositoriesEvent.bind(this),
      issues: this.handleIssuesEvent.bind(this),
      issue_comment: this.handleIssueCommentEvent.bind(this)
    };

    const handler = handlers[event];

    if (!handler) {
      logger.warn('No handler for webhook event:', { event });
      return {
        handled: false,
        event,
        message: 'No handler available for this event type'
      };
    }

    try {
      const result = await handler(payload);

      // Update installation metrics
      if (payload.installation?.id) {
        await this.updateInstallationMetrics(payload.installation.id.toString());
      }

      return {
        handled: true,
        event,
        result
      };
    } catch (error) {
      logger.error('Webhook handler error:', {
        event,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update installation metrics after webhook event
   * @param {string} installationId - GitHub installation ID
   */
  async updateInstallationMetrics(installationId) {
    try {
      const installation = await GitHubConnection.findOne({ installationId });

      if (installation) {
        installation.metrics = installation.metrics || {};
        installation.metrics.totalWebhooks = (installation.metrics.totalWebhooks || 0) + 1;
        installation.metrics.lastWebhookAt = new Date();
        await installation.save();
      }
    } catch (error) {
      logger.error('Failed to update installation metrics:', {
        installationId,
        error: error.message
      });
      // Don't throw - metrics update failure shouldn't fail webhook processing
    }
  }

  /**
   * Handle push events
   * Updates lastWebhookAt and triggers re-indexing if autoSync enabled
   *
   * @param {Object} payload - Push event payload
   * @returns {Promise<Object>} Processing result
   */
  async handlePushEvent(payload) {
    const repositoryId = payload.repository.id;
    const ref = payload.ref;
    const branch = ref.replace('refs/heads/', '');

    logger.debug('Processing push event:', { repositoryId, ref, branch });

    const installation = await GitHubConnection.findOne({
      installationId: payload.installation.id.toString(),
      monitoredRepositories: repositoryId
    });

    if (!installation) {
      logger.debug('No monitored installation for push event:', { repositoryId });
      return {
        action: 'push',
        monitored: false,
        repository: payload.repository.full_name,
        branch
      };
    }

    // TODO: Integration point for re-indexing service
    // If you have a codebase indexing service, queue re-indexing here
    logger.info('Push event on monitored repository:', {
      repositoryId,
      repository: payload.repository.full_name,
      branch,
      commits: payload.commits?.length || 0
    });

    return {
      action: 'push',
      monitored: true,
      repository: payload.repository.full_name,
      branch,
      commits: payload.commits?.length || 0,
      shouldIndex: true
    };
  }

  /**
   * Handle pull request events
   * Triggers re-indexing when PR merged
   *
   * @param {Object} payload - Pull request event payload
   * @returns {Promise<Object>} Processing result
   */
  async handlePullRequestEvent(payload) {
    const action = payload.action;
    const pr = payload.pull_request;
    const repositoryId = payload.repository.id;

    logger.debug('Processing pull_request event:', {
      repositoryId,
      action,
      prNumber: pr.number,
      merged: pr.merged
    });

    const installation = await GitHubConnection.findOne({
      installationId: payload.installation.id.toString(),
      monitoredRepositories: repositoryId
    });

    if (!installation) {
      logger.debug('No monitored installation for PR event:', { repositoryId });
      return {
        action,
        monitored: false,
        repository: payload.repository.full_name,
        prNumber: pr.number
      };
    }

    // If PR merged, trigger re-indexing
    if (action === 'closed' && pr.merged) {
      logger.info('PR merged on monitored repository:', {
        repositoryId,
        prNumber: pr.number,
        prTitle: pr.title,
        repository: payload.repository.full_name
      });

      // TODO: Integration point for re-indexing service
      return {
        action: 'merged',
        monitored: true,
        repository: payload.repository.full_name,
        prNumber: pr.number,
        prTitle: pr.title,
        shouldIndex: true
      };
    }

    return {
      action,
      monitored: true,
      repository: payload.repository.full_name,
      prNumber: pr.number,
      state: pr.state
    };
  }

  /**
   * Handle deployment events
   * @param {Object} payload - Deployment event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleDeploymentEvent(payload) {
    logger.debug('Deployment event received:', {
      repositoryId: payload.repository.id,
      environment: payload.deployment.environment,
      sha: payload.deployment.sha
    });

    return {
      action: 'deployment',
      repository: payload.repository.full_name,
      environment: payload.deployment.environment,
      sha: payload.deployment.sha
    };
  }

  /**
   * Handle deployment status events
   * Logs deployment failures for alerting
   *
   * @param {Object} payload - Deployment status event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleDeploymentStatusEvent(payload) {
    const state = payload.deployment_status.state;
    const repositoryId = payload.repository.id;

    logger.debug('Processing deployment_status event:', {
      repositoryId,
      state,
      environment: payload.deployment.environment
    });

    // If deployment failed, log for alerting (integration point for notification service)
    if (state === 'failure' || state === 'error') {
      logger.warn('Deployment failed:', {
        repositoryId,
        repository: payload.repository.full_name,
        environment: payload.deployment.environment,
        description: payload.deployment_status.description
      });

      // TODO: Integration point for alerting/notification service
      return {
        action: 'deployment_failed',
        repository: payload.repository.full_name,
        environment: payload.deployment.environment,
        state,
        description: payload.deployment_status.description,
        alertRequired: true
      };
    }

    return {
      action: 'deployment_status',
      repository: payload.repository.full_name,
      environment: payload.deployment.environment,
      state
    };
  }

  /**
   * Handle release events
   * @param {Object} payload - Release event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleReleaseEvent(payload) {
    const action = payload.action;

    logger.debug('Processing release event:', {
      action,
      repositoryId: payload.repository.id,
      tagName: payload.release?.tag_name
    });

    if (action === 'published') {
      logger.info('Release published:', {
        repository: payload.repository.full_name,
        tag: payload.release.tag_name,
        name: payload.release.name
      });
    }

    return {
      action,
      repository: payload.repository.full_name,
      tag: payload.release?.tag_name,
      name: payload.release?.name
    };
  }

  /**
   * Handle repository events (renamed, archived, deleted)
   * Updates repository metadata, disables monitoring for archived/deleted
   *
   * @param {Object} payload - Repository event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleRepositoryEvent(payload) {
    const action = payload.action;
    const repositoryId = payload.repository.id;

    logger.debug('Processing repository event:', {
      action,
      repositoryId,
      repoName: payload.repository.full_name
    });

    const installation = await GitHubConnection.findOne({
      installationId: payload.installation.id.toString()
    });

    if (!installation) {
      logger.warn('No installation found for repository event:', {
        installationId: payload.installation.id
      });
      return {
        action,
        repository: payload.repository.full_name,
        installationNotFound: true
      };
    }

    if (action === 'renamed') {
      // Update repository name in accessibleRepositories
      const repo = installation.accessibleRepositories.find(r => r.id === repositoryId);
      if (repo) {
        repo.name = payload.repository.name;
        repo.fullName = payload.repository.full_name;
        repo.htmlUrl = payload.repository.html_url;
        await installation.save();

        logger.info('Repository renamed in installation:', {
          repositoryId,
          oldName: payload.changes?.repository?.name?.from,
          newName: payload.repository.name
        });
      }

      return {
        action: 'renamed',
        repository: payload.repository.full_name,
        oldName: payload.changes?.repository?.name?.from
      };
    }

    if (action === 'archived' || action === 'deleted') {
      // Disable monitoring
      await installation.removeMonitoredRepository(repositoryId);

      // Remove from accessible repositories if deleted
      if (action === 'deleted') {
        installation.accessibleRepositories = installation.accessibleRepositories.filter(
          r => r.id !== repositoryId
        );
        await installation.save();
      }

      logger.warn('Repository action, monitoring disabled:', {
        action,
        repositoryId,
        repoName: payload.repository.full_name
      });

      return {
        action,
        repository: payload.repository.full_name,
        monitoringDisabled: true
      };
    }

    return {
      action,
      repository: payload.repository.full_name
    };
  }

  /**
   * Handle installation events (created, deleted, suspend, unsuspend)
   * Updates installation status
   *
   * @param {Object} payload - Installation event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleInstallationEvent(payload) {
    const action = payload.action;
    const installationId = payload.installation.id.toString();

    logger.info('Processing installation event:', { action, installationId });

    if (action === 'deleted') {
      await githubInstallationService.handleInstallationDeleted(installationId);

      logger.warn('GitHub installation deleted:', {
        installationId,
        accountLogin: payload.installation.account.login
      });

      return {
        action: 'deleted',
        installationId,
        account: payload.installation.account.login
      };
    }

    if (action === 'suspend') {
      const installation = await GitHubConnection.findOne({ installationId });

      if (installation) {
        installation.status = 'suspended';
        installation.suspendedAt = new Date();
        await installation.save();

        logger.warn('GitHub installation suspended:', {
          installationId,
          accountLogin: installation.accountLogin
        });
      }

      return {
        action: 'suspended',
        installationId
      };
    }

    if (action === 'unsuspend') {
      const installation = await GitHubConnection.findOne({ installationId });

      if (installation) {
        installation.status = 'active';
        installation.suspendedAt = null;
        await installation.save();

        logger.info('GitHub installation unsuspended:', {
          installationId,
          accountLogin: installation.accountLogin
        });
      }

      return {
        action: 'unsuspended',
        installationId
      };
    }

    if (action === 'created') {
      logger.info('New GitHub installation created:', {
        installationId,
        account: payload.installation.account.login
      });

      return {
        action: 'created',
        installationId,
        account: payload.installation.account.login
      };
    }

    return {
      action,
      installationId
    };
  }

  /**
   * Handle installation_repositories events (added, removed)
   * Syncs accessibleRepositories
   *
   * @param {Object} payload - Installation repositories event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleInstallationRepositoriesEvent(payload) {
    const action = payload.action;
    const installationId = payload.installation.id.toString();

    logger.info('Processing installation_repositories event:', {
      action,
      installationId,
      addedCount: payload.repositories_added?.length || 0,
      removedCount: payload.repositories_removed?.length || 0
    });

    const installation = await GitHubConnection.findOne({ installationId });

    if (!installation) {
      logger.warn('Installation not found for repositories event:', { installationId });
      return {
        action,
        installationId,
        installationNotFound: true
      };
    }

    const added = [];
    const removed = [];

    // Handle added repositories
    if (payload.repositories_added && payload.repositories_added.length > 0) {
      for (const repo of payload.repositories_added) {
        const exists = installation.accessibleRepositories.some(r => r.id === repo.id);

        if (!exists) {
          installation.accessibleRepositories.push({
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            defaultBranch: repo.default_branch || 'main',
            htmlUrl: repo.html_url,
            language: repo.language,
            size: repo.size,
            updatedAt: new Date()
          });

          added.push(repo.full_name);

          logger.info('Repository added to installation:', {
            installationId,
            repoId: repo.id,
            repoName: repo.full_name
          });
        }
      }
    }

    // Handle removed repositories
    if (payload.repositories_removed && payload.repositories_removed.length > 0) {
      for (const repo of payload.repositories_removed) {
        // Remove from accessible repositories
        installation.accessibleRepositories = installation.accessibleRepositories.filter(
          r => r.id !== repo.id
        );

        // Remove from monitored repositories
        installation.monitoredRepositories = installation.monitoredRepositories.filter(
          id => id !== repo.id
        );

        removed.push(repo.full_name);

        logger.info('Repository removed from installation:', {
          installationId,
          repoId: repo.id,
          repoName: repo.full_name
        });
      }
    }

    await installation.save();

    return {
      action,
      installationId,
      added,
      removed
    };
  }

  /**
   * Handle issues events
   * @param {Object} payload - Issues event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleIssuesEvent(payload) {
    logger.debug('Issues event received:', {
      action: payload.action,
      repository: payload.repository.full_name,
      issueNumber: payload.issue.number
    });

    return {
      action: payload.action,
      repository: payload.repository.full_name,
      issueNumber: payload.issue.number,
      title: payload.issue.title
    };
  }

  /**
   * Handle issue_comment events
   * @param {Object} payload - Issue comment event payload
   * @returns {Promise<Object>} Processing result
   */
  async handleIssueCommentEvent(payload) {
    logger.debug('Issue comment event received:', {
      action: payload.action,
      repository: payload.repository.full_name,
      issueNumber: payload.issue.number
    });

    return {
      action: payload.action,
      repository: payload.repository.full_name,
      issueNumber: payload.issue.number,
      commentId: payload.comment.id
    };
  }
}

module.exports = new GitHubEventService();
