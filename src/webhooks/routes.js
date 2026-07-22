const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../config');
const logger = require('../config/logger');
const driftAnalysisService = require('../integrations/github/services/driftAnalysisService');
const AppKitBuild = require('../appkit/models/AppKitBuild');
const appKitBuildService = require('../appkit/services/appKitBuildService');

// Import models for finding company connection
const mongoose = require('mongoose');

/**
 * Find the company + connection associated with a repository
 * Maps GitHub repository to Flora company for drift analysis context
 *
 * Both match branches below were previously comparing the wrong shape:
 * `accessibleRepositories` holds subdocuments (`{ id, fullName, ... }`), so
 * `{ $in: [repoFullName] }` against the array field itself never matches a
 * subdocument — it needs the dot-notation `accessibleRepositories.fullName`.
 * `monitoredRepositories` holds numeric GitHub repo IDs
 * (`GitHubConnection.addMonitoredRepository`), not full-name strings, so it
 * has to be matched against `repoId`, not `repoFullName`. This was a
 * pre-existing bug that made this function a no-op for both fields; fixing it
 * is what makes App Kit's repo registration (appKitDeployService.
 * registerRepoOnConnection, which calls addMonitoredRepository) actually
 * discoverable here.
 */
async function findConnectionForRepo(repoFullName, repoId) {
  try {
    const GitHubConnection = mongoose.model('GitHubConnection');
    const or = [{ 'accessibleRepositories.fullName': repoFullName }];
    if (typeof repoId === 'number') {
      or.push({ monitoredRepositories: repoId });
    }

    const connection = await GitHubConnection.findOne({
      status: 'active',
      $or: or
    }).lean();

    return connection ? {
      companyId: connection.companyId,
      userId: connection.userId,
      organizationId: connection.organizationId || connection.installationId
    } : null;
  } catch (error) {
    logger.warn('Failed to find connection for repo:', error.message);
    return null;
  }
}

/**
 * Persist a drift analysis result onto the AppKitBuild it belongs to (if the
 * PR's repo is one App Kit created — `AppKitBuild.repo` is unique, so this is
 * a direct lookup). Advances `tracking` -> `live` via appKitBuildService.advance
 * (not a hand-rolled phase write) so the Command Center callback still fires,
 * reusing driftAnalysisService's own `driftStatus === 'aligned'` definition
 * (already threshold-derived there) rather than re-deriving a cutoff here.
 * Best-effort: a build that isn't found, or a save/advance failure, must not
 * break webhook processing for non-App-Kit repos sharing this same handler.
 */
async function syncAppKitBuildDrift(repoFullName, driftResult) {
  if (!repoFullName || !driftResult) return;
  try {
    const build = await AppKitBuild.findOne({ repo: repoFullName });
    if (!build) return; // not an App Kit-originated repo

    build.driftScore = driftResult.overallScore;
    build.driftStatus = driftResult.driftStatus;

    if (build.phase === 'tracking' && driftResult.driftStatus === 'aligned') {
      await appKitBuildService.advance(build, 'live', `Drift analysis aligned (score ${driftResult.overallScore})`);
    } else {
      await build.save();
    }

    logger.info('App Kit build updated from drift analysis', {
      buildId: build.buildId,
      repo: repoFullName,
      driftScore: driftResult.overallScore,
      driftStatus: driftResult.driftStatus,
      phase: build.phase
    });
  } catch (error) {
    logger.warn('Failed to sync drift result onto AppKitBuild (non-fatal):', error.message);
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
          const connection = await findConnectionForRepo(repoFullName, req.body.repository?.id);

          if (connection) {
            setImmediate(() => {
              driftAnalysisService.analyzePullRequest(req.body, connection)
                .then(async result => {
                  if (result) {
                    logger.info(`Drift analysis completed for PR #${req.body.number}: score=${result.overallScore} status=${result.driftStatus}`);
                    await syncAppKitBuildDrift(repoFullName, result);
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
