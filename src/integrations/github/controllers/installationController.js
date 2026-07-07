const githubInstallationService = require('../services/githubInstallationService');
const logger = require('../../../config/logger');

/**
 * GitHub Installation Controller
 * Handles GitHub App installation management endpoints
 *
 * Migrated from monolith githubController with enhanced multi-tenant support
 */

/**
 * Get GitHub App installation URL
 * @route GET /api/integrations/github/install
 */
exports.getInstallationUrl = async (req, res) => {
  try {
    const { userId, organizationId, companyId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const installUrl = githubInstallationService.generateInstallationUrl({
      userId,
      organizationId,
      companyId
    });

    res.json({
      success: true,
      data: {
        installUrl
      }
    });
  } catch (error) {
    logger.error('getInstallationUrl error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Handle GitHub OAuth callback
 * @route GET /api/integrations/github/callback
 */
exports.handleCallback = async (req, res) => {
  try {
    const { code, installation_id, setup_action, state } = req.query;

    if (!code || !installation_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing authorization code or installation_id'
      });
    }

    const installation = await githubInstallationService.handleInstallationCallback({
      code,
      installationId: installation_id,
      state
    });

    res.json({
      success: true,
      message: 'GitHub App installed successfully',
      data: {
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        repositoryCount: installation.accessibleRepositories.length,
        status: installation.status
      }
    });
  } catch (error) {
    logger.error('handleCallback error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get all GitHub installations
 * @route GET /api/integrations/github/installations
 */
exports.getInstallations = async (req, res) => {
  try {
    const { userId, organizationId, companyId, status } = req.query;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either (userId and organizationId) or companyId is required'
      });
    }

    if (status) {
      filters.status = status;
    }

    const installations = await githubInstallationService.getInstallations(filters);

    res.json({
      success: true,
      data: installations.map(inst => ({
        id: inst._id,
        installationId: inst.installationId,
        accountLogin: inst.accountLogin,
        accountType: inst.accountType,
        status: inst.status,
        repositoryCount: inst.accessibleRepositories.length,
        monitoredCount: inst.monitoredRepositories.length,
        installedAt: inst.installedAt,
        lastSyncAt: inst.lastSyncAt || inst.lastSyncedAt,
        health: inst.health
      }))
    });
  } catch (error) {
    logger.error('getInstallations error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get specific GitHub installation
 * @route GET /api/integrations/github/installations/:id
 */
exports.getInstallation = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, organizationId, companyId } = req.query;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    }

    const installation = await githubInstallationService.getInstallation(id, filters);

    res.json({
      success: true,
      data: {
        id: installation._id,
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        status: installation.status,
        repositorySelection: installation.repositorySelection,
        accessibleRepositories: installation.accessibleRepositories,
        monitoredRepositories: installation.monitoredRepositories,
        installedAt: installation.installedAt,
        lastSyncAt: installation.lastSyncAt || installation.lastSyncedAt,
        health: installation.health,
        metrics: installation.metrics,
        webhookEvents: installation.webhookEvents
      }
    });
  } catch (error) {
    logger.error('getInstallation error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Manually sync GitHub installation (refresh repositories)
 * @route POST /api/integrations/github/installations/:id/sync
 */
exports.syncInstallation = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, organizationId, companyId } = req.body;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    }

    const installation = await githubInstallationService.syncInstallation(id, filters);

    res.json({
      success: true,
      message: 'Installation synced successfully',
      data: {
        installationId: installation.installationId,
        repositoryCount: installation.accessibleRepositories.length,
        lastSyncAt: installation.lastSyncAt || installation.lastSyncedAt
      }
    });
  } catch (error) {
    logger.error('syncInstallation error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Delete (uninstall) GitHub installation
 * @route DELETE /api/integrations/github/installations/:id
 */
exports.deleteInstallation = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, organizationId, companyId } = req.body;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    }

    const result = await githubInstallationService.deleteInstallation(id, filters);

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    logger.error('deleteInstallation error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get accessible repositories for installation
 * @route GET /api/integrations/github/installations/:id/repositories
 */
exports.getRepositories = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, organizationId, companyId } = req.query;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    }

    const installation = await githubInstallationService.getInstallation(id, filters);

    res.json({
      success: true,
      data: {
        repositories: installation.accessibleRepositories,
        monitored: installation.monitoredRepositories
      }
    });
  } catch (error) {
    logger.error('getRepositories error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Add repository to monitoring list
 * @route POST /api/integrations/github/installations/:id/repositories/:repoId/monitor
 */
exports.addMonitoredRepository = async (req, res) => {
  try {
    const { id, repoId } = req.params;
    const { userId, organizationId, companyId } = req.body;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    }

    const installation = await githubInstallationService.getInstallation(id, filters);

    // Verify repository is in accessible list
    const repository = installation.accessibleRepositories.find(
      repo => repo.id === parseInt(repoId)
    );

    if (!repository) {
      return res.status(404).json({
        success: false,
        message: `Repository ${repoId} is not accessible by this installation`
      });
    }

    // Add to monitored repositories
    await installation.addMonitoredRepository(parseInt(repoId));

    logger.info('Repository added to monitoring', {
      installationId: id,
      repoId,
      repoName: repository.name
    });

    res.json({
      success: true,
      message: 'Repository added to monitoring',
      data: {
        repository: repository,
        monitoredCount: installation.monitoredRepositories.length
      }
    });
  } catch (error) {
    logger.error('addMonitoredRepository error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Remove repository from monitoring list
 * @route DELETE /api/integrations/github/installations/:id/repositories/:repoId/monitor
 */
exports.removeMonitoredRepository = async (req, res) => {
  try {
    const { id, repoId } = req.params;
    const { userId, organizationId, companyId } = req.body;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    }

    const installation = await githubInstallationService.getInstallation(id, filters);

    // Remove from monitored repositories
    await installation.removeMonitoredRepository(parseInt(repoId));

    logger.info('Repository removed from monitoring', {
      installationId: id,
      repoId
    });

    res.json({
      success: true,
      message: 'Repository removed from monitoring',
      data: {
        monitoredCount: installation.monitoredRepositories.length
      }
    });
  } catch (error) {
    logger.error('removeMonitoredRepository error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Perform health check on installation
 * @route POST /api/integrations/github/installations/:id/health-check
 */
exports.performHealthCheck = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, organizationId, companyId } = req.body;

    // Support both new (userId+organizationId) and legacy (companyId) queries
    const filters = {};
    if (userId && organizationId) {
      filters.userId = userId;
      filters.organizationId = organizationId;
    } else if (companyId) {
      filters.companyId = companyId;
    }

    const installation = await githubInstallationService.performHealthCheck(id, filters);

    res.json({
      success: true,
      data: {
        health: installation.health,
        status: installation.status
      }
    });
  } catch (error) {
    logger.error('performHealthCheck error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};
