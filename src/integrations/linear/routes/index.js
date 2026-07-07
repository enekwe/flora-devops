const express = require('express');
const router = express.Router();
const linearService = require('../services/linearService');
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

    const authUrl = linearService.getAuthorizationUrl({
      userId,
      organizationId,
      state: state || crypto.randomBytes(16).toString('hex')
    });

    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    logger.error('Linear auth URL generation failed:', error);
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

    const connection = await linearService.connectAccount({
      code,
      userId,
      organizationId
    });

    res.json({
      success: true,
      message: 'Linear account connected successfully',
      data: connection
    });
  } catch (error) {
    logger.error('Linear OAuth callback failed:', error);
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

    const result = await linearService.disconnectAccount(userId, organizationId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Linear disconnect failed:', error);
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

    const status = await linearService.getConnectionStatus(userId, organizationId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Linear status check failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Team routes
router.get('/teams', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const teams = await linearService.listTeams(userId, organizationId);

    res.json({
      success: true,
      data: teams
    });
  } catch (error) {
    logger.error('Linear teams list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Issue routes
router.get('/issues', async (req, res) => {
  try {
    const { userId, organizationId, ...options } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issues = await linearService.listIssues(userId, organizationId, options);

    res.json({
      success: true,
      data: issues
    });
  } catch (error) {
    logger.error('Linear issues list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/issues', validateRequest(schemas.linearIssue), async (req, res) => {
  try {
    const { userId, organizationId, ...issueData } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issue = await linearService.createIssue(userId, organizationId, issueData);

    res.status(201).json({
      success: true,
      data: issue
    });
  } catch (error) {
    logger.error('Linear issue creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.patch('/issues/:issueId', async (req, res) => {
  try {
    const { userId, organizationId, ...updates } = req.body;
    const { issueId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const issue = await linearService.updateIssue(userId, organizationId, issueId, updates);

    res.json({
      success: true,
      data: issue
    });
  } catch (error) {
    logger.error('Linear issue update failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

// Webhook routes
router.post('/webhooks', validateRequest(schemas.webhook), async (req, res) => {
  try {
    const { userId, organizationId, ...webhookData } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const webhook = await linearService.createWebhook(userId, organizationId, webhookData);

    res.status(201).json({
      success: true,
      data: webhook
    });
  } catch (error) {
    logger.error('Linear webhook creation failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
