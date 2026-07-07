const express = require('express');
const router = express.Router();
const gitlabAuthService = require('../services/gitlabAuthService');
const gitlabService = require('../services/gitlabService');
const { validateRequest, schemas } = require('../../../utils/validation');
const logger = require('../../../config/logger');
const crypto = require('crypto');

// Authentication routes
router.get('/auth', (req, res) => {
  try {
    const { userId, organizationId, state } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const authUrl = gitlabAuthService.getAuthorizationUrl({
      userId,
      organizationId,
      state: state || crypto.randomBytes(16).toString('hex')
    });

    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    logger.error('GitLab auth URL generation failed:', error);
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

    const connection = await gitlabAuthService.connectAccount({
      code,
      userId,
      organizationId
    });

    res.json({
      success: true,
      message: 'GitLab account connected successfully',
      data: connection
    });
  } catch (error) {
    logger.error('GitLab OAuth callback failed:', error);
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

    const result = await gitlabAuthService.disconnectAccount(userId, organizationId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('GitLab disconnect failed:', error);
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

    const status = await gitlabAuthService.getConnectionStatus(userId, organizationId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('GitLab status check failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Project routes
router.get('/projects', async (req, res) => {
  try {
    const { userId, organizationId, ...options } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const projects = await gitlabService.listProjects(userId, organizationId, options);

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    logger.error('GitLab projects list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/projects', validateRequest(schemas.gitlabProject), async (req, res) => {
  try {
    const { userId, organizationId, ...projectData } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const project = await gitlabService.createProject(userId, organizationId, projectData);

    res.status(201).json({
      success: true,
      data: project
    });
  } catch (error) {
    logger.error('GitLab project creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Issue routes
router.get('/projects/:projectId/issues', async (req, res) => {
  try {
    const { userId, organizationId, ...options } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issues = await gitlabService.listIssues(userId, organizationId, projectId, options);

    res.json({
      success: true,
      data: issues
    });
  } catch (error) {
    logger.error('GitLab issues list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/projects/:projectId/issues', validateRequest(schemas.gitlabIssue), async (req, res) => {
  try {
    const { userId, organizationId, ...issueData } = req.body;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issue = await gitlabService.createIssue(userId, organizationId, projectId, issueData);

    res.status(201).json({
      success: true,
      data: issue
    });
  } catch (error) {
    logger.error('GitLab issue creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Pipeline routes
router.get('/projects/:projectId/pipelines', async (req, res) => {
  try {
    const { userId, organizationId, ...options } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const pipelines = await gitlabService.listPipelines(userId, organizationId, projectId, options);

    res.json({
      success: true,
      data: pipelines
    });
  } catch (error) {
    logger.error('GitLab pipelines list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/projects/:projectId/pipelines/:pipelineId', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;
    const { projectId, pipelineId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const pipeline = await gitlabService.getPipeline(userId, organizationId, projectId, pipelineId);

    res.json({
      success: true,
      data: pipeline
    });
  } catch (error) {
    logger.error('GitLab pipeline get failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/projects/:projectId/pipelines', async (req, res) => {
  try {
    const { userId, organizationId, ref, variables } = req.body;
    const { projectId } = req.params;

    if (!userId || !organizationId || !ref) {
      return res.status(400).json({
        success: false,
        message: 'userId, organizationId, and ref are required'
      });
    }

    const pipeline = await gitlabService.createPipeline(
      userId,
      organizationId,
      projectId,
      ref,
      variables
    );

    res.status(201).json({
      success: true,
      data: pipeline
    });
  } catch (error) {
    logger.error('GitLab pipeline creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Webhook routes
router.get('/projects/:projectId/hooks', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const webhooks = await gitlabService.listWebhooks(userId, organizationId, projectId);

    res.json({
      success: true,
      data: webhooks
    });
  } catch (error) {
    logger.error('GitLab webhooks list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/projects/:projectId/hooks', validateRequest(schemas.webhook), async (req, res) => {
  try {
    const { userId, organizationId, ...webhookData } = req.body;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const webhook = await gitlabService.createWebhook(
      userId,
      organizationId,
      projectId,
      webhookData
    );

    res.status(201).json({
      success: true,
      data: webhook
    });
  } catch (error) {
    logger.error('GitLab webhook creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
