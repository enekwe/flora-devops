const express = require('express');
const router = express.Router();
const deploymentService = require('../services/deploymentService');
const logger = require('../../../config/logger');
const crypto = require('crypto');

// === VERCEL ROUTES ===

router.get('/vercel/auth', (req, res) => {
  try {
    const { userId, organizationId, state } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const authUrl = deploymentService.getVercelAuthUrl({
      userId,
      organizationId,
      state: state || crypto.randomBytes(16).toString('hex')
    });

    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    logger.error('Vercel auth URL generation failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/vercel/callback', async (req, res) => {
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

    const connection = await deploymentService.connectVercel({
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

router.delete('/vercel/disconnect', async (req, res) => {
  try {
    const { userId, organizationId } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const result = await deploymentService.disconnect(userId, organizationId, 'vercel');

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

router.get('/vercel/status', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const status = await deploymentService.getStatus(userId, organizationId, 'vercel');

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

router.get('/vercel/projects', async (req, res) => {
  try {
    const { userId, organizationId, ...options } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const projects = await deploymentService.listVercelProjects(userId, organizationId, options);

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

router.get('/vercel/projects/:projectId/deployments', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;
    const { projectId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const deployments = await deploymentService.listVercelDeployments(
      userId,
      organizationId,
      projectId
    );

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

// === NETLIFY ROUTES ===

router.get('/netlify/auth', (req, res) => {
  try {
    const { userId, organizationId, state } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const authUrl = deploymentService.getNetlifyAuthUrl({
      userId,
      organizationId,
      state: state || crypto.randomBytes(16).toString('hex')
    });

    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    logger.error('Netlify auth URL generation failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/netlify/callback', async (req, res) => {
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

    const connection = await deploymentService.connectNetlify({
      code,
      userId,
      organizationId
    });

    res.json({
      success: true,
      message: 'Netlify account connected successfully',
      data: connection
    });
  } catch (error) {
    logger.error('Netlify OAuth callback failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.delete('/netlify/disconnect', async (req, res) => {
  try {
    const { userId, organizationId } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const result = await deploymentService.disconnect(userId, organizationId, 'netlify');

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Netlify disconnect failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/netlify/status', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const status = await deploymentService.getStatus(userId, organizationId, 'netlify');

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Netlify status check failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/netlify/sites', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const sites = await deploymentService.listNetlifySites(userId, organizationId);

    res.json({
      success: true,
      data: sites
    });
  } catch (error) {
    logger.error('Netlify sites list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/netlify/sites/:siteId/deploys', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;
    const { siteId } = req.params;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'userId and organizationId are required'
      });
    }

    const deploys = await deploymentService.listNetlifyDeploys(userId, organizationId, siteId);

    res.json({
      success: true,
      data: deploys
    });
  } catch (error) {
    logger.error('Netlify deploys list failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
