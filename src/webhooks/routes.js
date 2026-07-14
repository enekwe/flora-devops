const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../config');
const logger = require('../config/logger');
const driftAnalysisService = require('../integrations/github/services/driftAnalysisService');

// Import models for finding company connection
const mongoose = require('mongoose');

/**
 * Find the company + connection associated with a repository
 * Maps GitHub repository to Flora company for drift analysis context
 */
async function findConnectionForRepo(repoFullName) {
  try {
    const GitHubConnection = mongoose.model('GitHubConnection');
    const connection = await GitHubConnection.findOne({
      'accessibleRepositories': { $in: [repoFullName] },
      'status': 'active'
    }).lean();

    if (connection) {
      return {
        companyId: connection.companyId,
        userId: connection.userId,
        organizationId: connection.organizationId || connection.installationId
      };
    }

    // Fallback: check monitored repositories
    const monitoredConnection = await GitHubConnection.findOne({
      'monitoredRepositories': { $in: [repoFullName] },
      'status': 'active'
    }).lean();

    return monitoredConnection ? {
      companyId: monitoredConnection.companyId,
      userId: monitoredConnection.userId,
      organizationId: monitoredConnection.organizationId || monitoredConnection.installationId
    } : null;
  } catch (error) {
    logger.warn('Failed to find connection for repo:', error.message);
    return null;
  }
}

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(payload, signature) {
  if (!signature || !config.GITHUB_WEBHOOK_SECRET) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

/**
 * GitHub webhook handler
 */
router.post('/github', async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const delivery = req.headers['x-github-delivery'];
    const payload = JSON.stringify(req.body);

    // Verify signature
    if (!verifyGitHubSignature(payload, signature)) {
      logger.warn('Invalid GitHub webhook signature', { delivery });
      return res.status(401).json({
        success: false,
        message: 'Invalid signature'
      });
    }

    logger.info(`GitHub webhook received: ${event}`, {
      event,
      delivery,
      repository: req.body.repository?.full_name,
      action: req.body.action
    });

    // Process webhook based on event type
    switch (event) {
      case 'push':
        logger.info('GitHub push event', {
          ref: req.body.ref,
          commits: req.body.commits?.length,
          pusher: req.body.pusher?.name
        });
        break;

      case 'pull_request':
        logger.info('GitHub pull request event', {
          action: req.body.action,
          number: req.body.number,
          title: req.body.pull_request?.title
        });

        // E2-US1: Trigger drift analysis on PR open/sync/reopen
        if (['opened', 'synchronize', 'reopened'].includes(req.body.action)) {
          const repoFullName = req.body.repository?.full_name;
          const connection = await findConnectionForRepo(repoFullName);

          if (connection) {
            setImmediate(() => {
              driftAnalysisService.analyzePullRequest(req.body, connection)
                .then(result => {
                  if (result) {
                    logger.info(`Drift analysis completed for PR #${req.body.number}: score=${result.overallScore} status=${result.driftStatus}`);
                  }
                })
                .catch(err => logger.error('Async drift analysis error:', err));
            });
          } else {
            logger.info(`No Flora connection found for repo ${repoFullName} — skipping drift analysis`);
          }
        }
        break;

      case 'issues':
        logger.info('GitHub issues event', {
          action: req.body.action,
          number: req.body.issue?.number,
          title: req.body.issue?.title
        });
        break;

      case 'deployment':
        logger.info('GitHub deployment event', {
          deployment: req.body.deployment?.id,
          environment: req.body.deployment?.environment,
          ref: req.body.deployment?.ref
        });
        break;

      case 'deployment_status':
        logger.info('GitHub deployment status event', {
          state: req.body.deployment_status?.state,
          deployment: req.body.deployment?.id
        });
        break;

      default:
        logger.info(`GitHub ${event} event received`);
    }

    res.json({
      success: true,
      message: 'Webhook received',
      event
    });
  } catch (error) {
    logger.error('GitHub webhook processing failed:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

/**
 * Generic webhook handler (for deployment platforms)
 */
router.post('/deployment', async (req, res) => {
  try {
    const platform = req.headers['x-platform'] || 'unknown';

    logger.info(`Deployment webhook received from ${platform}`, {
      platform,
      body: req.body
    });

    res.json({
      success: true,
      message: 'Deployment webhook received',
      platform
    });
  } catch (error) {
    logger.error('Deployment webhook processing failed:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

module.exports = router;
