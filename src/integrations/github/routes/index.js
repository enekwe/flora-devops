const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const githubAuthService = require('../services/githubAuthService');
const githubRepoService = require('../services/githubRepoService');
const githubIssueService = require('../services/githubIssueService');
const githubDeploymentService = require('../services/githubDeploymentService');
const githubWebhookService = require('../services/githubWebhookService');
const githubEventService = require('../services/githubEventService');
const installationController = require('../controllers/installationController');
const { validateRequest, schemas } = require('../../../utils/validation');
const logger = require('../../../config/logger');

// ============================================================================
// GitHub App Installation Routes (Merged from Monolith)
// ============================================================================

/**
 * @route   GET /api/integrations/github/install
 * @desc    Get GitHub App installation URL
 * @access  Public (OAuth flow)
 */
router.get('/install', installationController.getInstallationUrl);

/**
 * @route   GET /api/integrations/github/callback
 * @desc    Handle GitHub App installation callback
 * @access  Public (OAuth flow)
 */
router.get('/callback', installationController.handleCallback);

/**
 * @route   GET /api/integrations/github/installations
 * @desc    Get all GitHub App installations
 * @access  Private
 */
router.get('/installations', installationController.getInstallations);

/**
 * @route   GET /api/integrations/github/installations/:id
 * @desc    Get specific GitHub App installation
 * @access  Private
 */
router.get('/installations/:id', installationController.getInstallation);

/**
 * @route   POST /api/integrations/github/installations/:id/sync
 * @desc    Manually sync GitHub App installation (refresh repositories)
 * @access  Private
 */
router.post('/installations/:id/sync', installationController.syncInstallation);

/**
 * @route   DELETE /api/integrations/github/installations/:id
 * @desc    Delete (uninstall) GitHub App installation
 * @access  Private
 */
router.delete('/installations/:id', installationController.deleteInstallation);

/**
 * @route   GET /api/integrations/github/installations/:id/repositories
 * @desc    Get accessible repositories for installation
 * @access  Private
 */
router.get('/installations/:id/repositories', installationController.getRepositories);

/**
 * @route   POST /api/integrations/github/installations/:id/repositories/:repoId/monitor
 * @desc    Add repository to monitoring list
 * @access  Private
 */
router.post('/installations/:id/repositories/:repoId/monitor', installationController.addMonitoredRepository);

/**
 * @route   DELETE /api/integrations/github/installations/:id/repositories/:repoId/monitor
 * @desc    Remove repository from monitoring list
 * @access  Private
 */
router.delete('/installations/:id/repositories/:repoId/monitor', installationController.removeMonitoredRepository);

/**
 * @route   POST /api/integrations/github/installations/:id/health-check
 * @desc    Perform health check on installation
 * @access  Private
 */
router.post('/installations/:id/health-check', installationController.performHealthCheck);

// ============================================================================
// OAuth Authentication routes (User-level GitHub connections)
// ============================================================================

/**
 * @route   GET /api/integrations/github/auth
 * @desc    Get GitHub OAuth authorization URL (user-level)
 * @access  Public
 */
router.get('/auth', (req, res) => {
  try {
    const { userId, organizationId, state } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const authUrl = githubAuthService.getAuthorizationUrl({
      userId,
      organizationId,
      state: state || crypto.randomBytes(16).toString('hex')
    });

    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    logger.error('GitHub auth URL generation failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        message: 'Missing authorization code or state'
      });
    }

    const stateData = JSON.parse(state);
    const { userId, organizationId } = stateData;

    const connection = await githubAuthService.connectAccount({
      code,
      userId,
      organizationId
    });

    res.json({
      success: true,
      message: 'GitHub account connected successfully',
      data: connection
    });
  } catch (error) {
    logger.error('GitHub OAuth callback failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.delete('/disconnect', async (req, res) => {
  try {
    const { userId, organizationId } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const result = await githubAuthService.disconnectAccount(userId, organizationId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('GitHub disconnect failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/status', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const status = await githubAuthService.getConnectionStatus(userId, organizationId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('GitHub status check failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Repository routes
router.get('/repos', async (req, res) => {
  try {
    const { userId, organizationId, ...options } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const repos = await githubRepoService.listRepositories(userId, organizationId, options);

    res.json({
      success: true,
      data: repos
    });
  } catch (error) {
    logger.error('GitHub repos list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/repos/:owner/:repo', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;
    const { owner, repo } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const repository = await githubRepoService.getRepository(userId, organizationId, owner, repo);

    res.json({
      success: true,
      data: repository
    });
  } catch (error) {
    logger.error('GitHub repo get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/repos', validateRequest(schemas.githubRepo), async (req, res) => {
  try {
    const { userId, organizationId, ...repoData } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const repo = await githubRepoService.createRepository(userId, organizationId, repoData);

    res.status(201).json({
      success: true,
      data: repo
    });
  } catch (error) {
    logger.error('GitHub repo creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.patch('/repos/:owner/:repo', async (req, res) => {
  try {
    const { userId, organizationId, ...updates } = req.body;
    const { owner, repo } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const repository = await githubRepoService.updateRepository(
      userId,
      organizationId,
      owner,
      repo,
      updates
    );

    res.json({
      success: true,
      data: repository
    });
  } catch (error) {
    logger.error('GitHub repo update failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.delete('/repos/:owner/:repo', async (req, res) => {
  try {
    const { userId, organizationId } = req.body;
    const { owner, repo } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const result = await githubRepoService.deleteRepository(userId, organizationId, owner, repo);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('GitHub repo deletion failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Issue routes
router.get('/repos/:owner/:repo/issues', async (req, res) => {
  try {
    const { userId, organizationId, ...options } = req.query;
    const { owner, repo } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issues = await githubIssueService.listIssues(
      userId,
      organizationId,
      owner,
      repo,
      options
    );

    res.json({
      success: true,
      data: issues
    });
  } catch (error) {
    logger.error('GitHub issues list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/repos/:owner/:repo/issues/:issueNumber', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;
    const { owner, repo, issueNumber } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issue = await githubIssueService.getIssue(
      userId,
      organizationId,
      owner,
      repo,
      parseInt(issueNumber)
    );

    res.json({
      success: true,
      data: issue
    });
  } catch (error) {
    logger.error('GitHub issue get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/repos/:owner/:repo/issues', validateRequest(schemas.githubIssue), async (req, res) => {
  try {
    const { userId, organizationId, ...issueData } = req.body;
    const { owner, repo } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issue = await githubIssueService.createIssue(
      userId,
      organizationId,
      owner,
      repo,
      issueData
    );

    res.status(201).json({
      success: true,
      data: issue
    });
  } catch (error) {
    logger.error('GitHub issue creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Webhook routes
router.get('/repos/:owner/:repo/hooks', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;
    const { owner, repo } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const webhooks = await githubWebhookService.listWebhooks(userId, organizationId, owner, repo);

    res.json({
      success: true,
      data: webhooks
    });
  } catch (error) {
    logger.error('GitHub webhooks list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/repos/:owner/:repo/hooks', validateRequest(schemas.webhook), async (req, res) => {
  try {
    const { userId, organizationId, ...webhookData } = req.body;
    const { owner, repo } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const webhook = await githubWebhookService.createWebhook(
      userId,
      organizationId,
      owner,
      repo,
      webhookData
    );

    res.status(201).json({
      success: true,
      data: webhook
    });
  } catch (error) {
    logger.error('GitHub webhook creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Webhook handler endpoint (merged from monolith with enhanced processing)
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];
    const payload = JSON.stringify(req.body);

    // Verify webhook signature
    const isValid = githubWebhookService.verifySignature(payload, signature);

    if (!isValid) {
      logger.warn('Invalid GitHub webhook signature', { deliveryId });
      return res.status(401).json({
        success: false,
        message: 'Invalid signature'
      });
    }

    logger.info('GitHub webhook received:', {
      event,
      deliveryId,
      repository: req.body.repository?.full_name,
      installation: req.body.installation?.id
    });

    // Process webhook event using event service
    const result = await githubEventService.processWebhookEvent(event, req.body);

    res.json({
      success: true,
      message: 'Webhook processed successfully',
      data: result
    });
  } catch (error) {
    logger.error('GitHub webhook processing failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
