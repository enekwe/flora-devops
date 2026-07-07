const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../config');
const logger = require('../config/logger');

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
 * Verify GitLab webhook token
 */
function verifyGitLabToken(token) {
  return token === config.GITLAB_WEBHOOK_SECRET;
}

/**
 * Verify Linear webhook signature
 */
function verifyLinearSignature(payload, signature) {
  if (!signature || !config.LINEAR_WEBHOOK_SECRET) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.LINEAR_WEBHOOK_SECRET);
  const digest = hmac.update(payload).digest('hex');

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
 * GitLab webhook handler
 */
router.post('/gitlab', async (req, res) => {
  try {
    const token = req.headers['x-gitlab-token'];
    const event = req.headers['x-gitlab-event'];

    // Verify token
    if (!verifyGitLabToken(token)) {
      logger.warn('Invalid GitLab webhook token');
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    logger.info(`GitLab webhook received: ${event}`, {
      event,
      project: req.body.project?.path_with_namespace,
      objectKind: req.body.object_kind
    });

    // Process webhook based on event type
    switch (req.body.object_kind || event) {
      case 'push':
        logger.info('GitLab push event', {
          ref: req.body.ref,
          commits: req.body.commits?.length,
          userName: req.body.user_name
        });
        break;

      case 'merge_request':
        logger.info('GitLab merge request event', {
          action: req.body.object_attributes?.action,
          iid: req.body.object_attributes?.iid,
          title: req.body.object_attributes?.title
        });
        break;

      case 'issue':
        logger.info('GitLab issue event', {
          action: req.body.object_attributes?.action,
          iid: req.body.object_attributes?.iid,
          title: req.body.object_attributes?.title
        });
        break;

      case 'pipeline':
        logger.info('GitLab pipeline event', {
          status: req.body.object_attributes?.status,
          id: req.body.object_attributes?.id,
          ref: req.body.object_attributes?.ref
        });
        break;

      default:
        logger.info(`GitLab ${event || req.body.object_kind} event received`);
    }

    res.json({
      success: true,
      message: 'Webhook received',
      event: event || req.body.object_kind
    });
  } catch (error) {
    logger.error('GitLab webhook processing failed:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

/**
 * Linear webhook handler
 */
router.post('/linear', async (req, res) => {
  try {
    const signature = req.headers['linear-signature'];
    const payload = JSON.stringify(req.body);

    // Verify signature
    if (config.LINEAR_WEBHOOK_SECRET && !verifyLinearSignature(payload, signature)) {
      logger.warn('Invalid Linear webhook signature');
      return res.status(401).json({
        success: false,
        message: 'Invalid signature'
      });
    }

    logger.info('Linear webhook received', {
      type: req.body.type,
      action: req.body.action,
      createdAt: req.body.createdAt
    });

    // Process webhook based on type
    switch (req.body.type) {
      case 'Issue':
        logger.info('Linear issue event', {
          action: req.body.action,
          issueId: req.body.data?.id,
          title: req.body.data?.title
        });
        break;

      case 'Comment':
        logger.info('Linear comment event', {
          action: req.body.action,
          commentId: req.body.data?.id
        });
        break;

      case 'Project':
        logger.info('Linear project event', {
          action: req.body.action,
          projectId: req.body.data?.id,
          name: req.body.data?.name
        });
        break;

      default:
        logger.info(`Linear ${req.body.type} event received`);
    }

    res.json({
      success: true,
      message: 'Webhook received',
      type: req.body.type
    });
  } catch (error) {
    logger.error('Linear webhook processing failed:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

/**
 * Generic webhook handler (for Vercel, Netlify, etc.)
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
