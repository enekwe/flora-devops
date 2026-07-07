const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const railwayAuthService = require('../services/railwayAuthService');
const railwayService = require('../services/railwayService');
const logger = require('../../../config/logger');

/**
 * Middleware to check if Railway integration is available
 */
const checkAvailability = (req, res, next) => {
  if (!railwayAuthService.isAvailable()) {
    return res.status(503).json({
      success: false,
      available: false,
      status: 'coming_soon',
      message: 'Railway integration coming soon. OAuth credentials not yet configured.'
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

    const authUrl = railwayAuthService.getAuthorizationUrl({
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
    logger.error('Railway auth URL generation failed:', error);
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
      logger.error('Railway OAuth error:', { error, error_description });
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
    const connection = await railwayAuthService.connectAccount({
      code,
      userId,
      organizationId
    });

    res.json({
      success: true,
      message: 'Railway account connected successfully',
      data: connection
    });
  } catch (error) {
    logger.error('Railway OAuth callback failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /disconnect
 * Disconnect Railway account
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

    const result = await railwayAuthService.disconnectAccount(userId, organizationId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Railway disconnect failed:', error);
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

    const status = await railwayAuthService.getConnectionStatus(userId, organizationId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Railway status check failed:', error);
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
    const { userId, organizationId, teamId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    // Get connection
    const connection = await railwayService.getConnection(userId, organizationId);

    const options = {};

    const projects = await railwayService.listProjects(connection._id, teamId, options);

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    logger.error('Railway projects list failed:', error);
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

    const connection = await railwayService.getConnection(userId, organizationId);

    const project = await railwayService.getProject(connection._id, projectId, teamId);

    res.json({
      success: true,
      data: project
    });
  } catch (error) {
    logger.error('Railway project get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /projects
 * Create a new project
 */
router.post('/projects', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const projectData = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    if (!projectData.name) {
      return res.status(400).json({
        success: false,
        message: 'name is required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    const project = await railwayService.createProject(connection._id, projectData, teamId);

    res.json({
      success: true,
      message: 'Project created successfully',
      data: project
    });
  } catch (error) {
    logger.error('Railway project create failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// ============ SERVICE ROUTES ============

/**
 * GET /projects/:projectId/services
 * List services for a project
 */
router.get('/projects/:projectId/services', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    const services = await railwayService.listServices(connection._id, projectId, teamId);

    res.json({
      success: true,
      data: services
    });
  } catch (error) {
    logger.error('Railway services list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /services/:serviceId
 * Get service details
 */
router.get('/services/:serviceId', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { serviceId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    const service = await railwayService.getService(connection._id, serviceId, teamId);

    res.json({
      success: true,
      data: service
    });
  } catch (error) {
    logger.error('Railway service get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /projects/:projectId/services
 * Create a new service
 */
router.post('/projects/:projectId/services', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { projectId } = req.params;
    const serviceData = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    if (!serviceData.name) {
      return res.status(400).json({
        success: false,
        message: 'name is required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    serviceData.projectId = projectId;

    const service = await railwayService.createService(connection._id, serviceData, teamId);

    res.json({
      success: true,
      message: 'Service created successfully',
      data: service
    });
  } catch (error) {
    logger.error('Railway service create failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// ============ DEPLOYMENT ROUTES ============

/**
 * GET /services/:serviceId/deployments
 * List deployments for a service
 */
router.get('/services/:serviceId/deployments', async (req, res) => {
  try {
    const { userId, organizationId, teamId, first } = req.query;
    const { serviceId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    const options = {};
    if (first) options.first = parseInt(first);

    const deployments = await railwayService.listDeployments(connection._id, serviceId, teamId, options);

    res.json({
      success: true,
      data: deployments
    });
  } catch (error) {
    logger.error('Railway deployments list failed:', error);
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

    const connection = await railwayService.getConnection(userId, organizationId);

    const deployment = await railwayService.getDeployment(connection._id, deploymentId, teamId);

    res.json({
      success: true,
      data: deployment
    });
  } catch (error) {
    logger.error('Railway deployment get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /services/:serviceId/deployments
 * Trigger a new deployment
 */
router.post('/services/:serviceId/deployments', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { serviceId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    const deployment = await railwayService.triggerDeployment(connection._id, serviceId, teamId);

    res.json({
      success: true,
      message: 'Deployment triggered successfully',
      data: deployment
    });
  } catch (error) {
    logger.error('Railway deployment trigger failed:', error);
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
    const { userId, organizationId, teamId } = req.query;
    const { deploymentId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    const logs = await railwayService.getDeploymentLogs(connection._id, deploymentId, teamId);

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    logger.error('Railway deployment logs failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// ============ ENVIRONMENT VARIABLES ROUTES ============

/**
 * GET /services/:serviceId/env
 * Get environment variables for a service
 */
router.get('/services/:serviceId/env', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { serviceId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    const envs = await railwayService.getEnvironmentVariables(connection._id, serviceId, teamId);

    res.json({
      success: true,
      data: envs
    });
  } catch (error) {
    logger.error('Railway environment variables get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /services/:serviceId/env
 * Set environment variables for a service
 */
router.post('/services/:serviceId/env', async (req, res) => {
  try {
    const { userId, organizationId, teamId } = req.query;
    const { serviceId } = req.params;
    const variables = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    if (!variables || typeof variables !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'variables object is required'
      });
    }

    const connection = await railwayService.getConnection(userId, organizationId);

    await railwayService.setEnvironmentVariables(connection._id, serviceId, variables, teamId);

    res.json({
      success: true,
      message: 'Environment variables updated successfully'
    });
  } catch (error) {
    logger.error('Railway environment variables set failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
