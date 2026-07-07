const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const vercelAuthService = require('../services/vercelAuthService');
const vercelService = require('../services/vercelService');
const logger = require('../../../config/logger');

/**
 * Middleware to check if Vercel integration is available
 */
const checkAvailability = (req, res, next) => {
  if (!vercelAuthService.isAvailable()) {
    return res.status(503).json({
      success: false,
      available: false,
      status: 'coming_soon',
      message: 'Vercel integration coming soon. OAuth credentials not yet configured.'
    });
  }
  next();
};

// ============ AUTHENTICATION ROUTES ============

/**
 * GET /auth
 * Generate OAuth authorization URL
 */
router.get('/auth', checkAvailability, (req, res) => {
  try {
    const { userId, organizationId, state } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const csrfToken = state || crypto.randomBytes(16).toString('hex');

    const authUrl = vercelAuthService.getAuthorizationUrl({
      userId,
      organizationId,
      state: csrfToken
    });

    res.json({
      success: true,
      authUrl,
      state: csrfToken
    });
  } catch (error) {
    logger.error('Vercel auth URL generation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /callback
 * Handle OAuth callback
 */
router.get('/callback', checkAvailability, async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Handle OAuth errors
    if (error) {
      logger.error('Vercel OAuth error:', { error, error_description });
      return res.status(400).json({
        success: false,
        message: error_description || error
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        message: 'Missing authorization code or state'
      });
    }

    // Parse state to get userId and organizationId
    let stateData;
    try {
      stateData = JSON.parse(state);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid state parameter'
      });
    }

    const { userId, organizationId } = stateData;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid state: missing userId or organizationId'
      });
    }

    // Connect the account
    const connection = await vercelAuthService.connectAccount({
      code,
      userId,
      organizationId
    });

    res.json({
      success: true,
      message: 'Vercel account connected successfully',
      data: connection
    });
  } catch (error) {
    logger.error('Vercel OAuth callback failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /disconnect
 * Disconnect Vercel account
 */
router.post('/disconnect', async (req, res) => {
  try {
    const { userId, organizationId } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const result = await vercelAuthService.disconnectAccount(userId, organizationId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Vercel disconnect failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /status
 * Get connection status (returns "coming soon" if no OAuth credentials)
 */
router.get('/status', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const status = await vercelAuthService.getConnectionStatus(userId, organizationId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Vercel status check failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// ============ PROJECT ROUTES ============

/**
 * GET /projects
 * List all projects
 */
router.get('/projects', async (req, res) => {
  try {
    const { userId, organizationId, teamId, limit, search } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    // Get connection
    const connection = await vercelService.getConnection(userId, organizationId);

    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (search) options.search = search;

    const projects = await vercelService.listProjects(connection._id, teamId, options);

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    logger.error('Vercel projects list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /projects/:projectId
 * Get project details
 */
router.get('/projects/:projectId', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const project = await vercelService.getProject(connection._id, projectId, teamId);

    res.json({
      success: true,
      data: project
    });
  } catch (error) {
    logger.error('Vercel project get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// ============ DEPLOYMENT ROUTES ============

/**
 * GET /projects/:projectId/deployments
 * List deployments for a project
 */
router.get('/projects/:projectId/deployments', async (req, res) => {
  try {
    const { userId, organizationId, teamId, limit, state, target } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (state) options.state = state;
    if (target) options.target = target;

    const deployments = await vercelService.listDeployments(connection._id, projectId, teamId, options);

    res.json({
      success: true,
      data: deployments
    });
  } catch (error) {
    logger.error('Vercel deployments list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /deployments/:deploymentId
 * Get deployment details
 */
router.get('/deployments/:deploymentId', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { deploymentId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const deployment = await vercelService.getDeployment(connection._id, deploymentId, teamId);

    res.json({
      success: true,
      data: deployment
    });
  } catch (error) {
    logger.error('Vercel deployment get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /deployments/:deploymentId/logs
 * Get deployment logs
 */
router.get('/deployments/:deploymentId/logs', async (req, res) => {
  try {
    const { userId, organizationId, teamId, limit, follow } = req.query;
    const { deploymentId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (follow) options.follow = follow === 'true';

    const logs = await vercelService.getDeploymentLogs(connection._id, deploymentId, teamId, options);

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    logger.error('Vercel deployment logs failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// ============ DOMAIN ROUTES ============

/**
 * GET /projects/:projectId/domains
 * List domains for a project
 */
router.get('/projects/:projectId/domains', async (req, res) => {
  try {
    const { userId, organizationId, teamId, limit } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const options = {};
    if (limit) options.limit = parseInt(limit);

    const domains = await vercelService.listDomains(connection._id, projectId, teamId, options);

    res.json({
      success: true,
      data: domains
    });
  } catch (error) {
    logger.error('Vercel domains list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// ============ ENVIRONMENT VARIABLES ROUTES ============

/**
 * GET /projects/:projectId/env
 * Get environment variables for a project
 */
router.get('/projects/:projectId/env', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const envs = await vercelService.getEnvironmentVariables(connection._id, projectId, teamId);

    res.json({
      success: true,
      data: envs
    });
  } catch (error) {
    logger.error('Vercel environment variables get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /projects/:projectId/env
 * Create an environment variable
 */
router.post('/projects/:projectId/env', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { projectId } = req.params;
    const envData = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    if (!envData.key || !envData.value || !envData.target) {
      return res.status(400).json({
        success: false,
        message: 'key, value, and target are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const env = await vercelService.createEnvironmentVariable(
      connection._id,
      projectId,
      envData,
      teamId
    );

    res.json({
      success: true,
      message: 'Environment variable created successfully',
      data: env
    });
  } catch (error) {
    logger.error('Vercel environment variable create failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PATCH /projects/:projectId/env/:envId
 * Update an environment variable
 */
router.patch('/projects/:projectId/env/:envId', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { projectId, envId } = req.params;
    const envData = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    const env = await vercelService.updateEnvironmentVariable(
      connection._id,
      projectId,
      envId,
      envData,
      teamId
    );

    res.json({
      success: true,
      message: 'Environment variable updated successfully',
      data: env
    });
  } catch (error) {
    logger.error('Vercel environment variable update failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /projects/:projectId/env/:envId
 * Delete an environment variable
 */
router.delete('/projects/:projectId/env/:envId', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { projectId, envId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await vercelService.getConnection(userId, organizationId);

    await vercelService.deleteEnvironmentVariable(
      connection._id,
      projectId,
      envId,
      teamId
    );

    res.json({
      success: true,
      message: 'Environment variable deleted successfully'
    });
  } catch (error) {
    logger.error('Vercel environment variable delete failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
