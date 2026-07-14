const axios = require('axios');
const logger = require('../config/logger');
const config = require('../config');
const githubIssueService = require('./githubIssueService');
const githubAuthService = require('./githubAuthService');

/**
 * Drift Analysis Service
 * E2-US1/E2-US2: Automated PR drift analysis against Flora requirements
 *
 * When a PR is opened or updated:
 * 1. Fetch PR diff from GitHub
 * 2. Query Command Center knowledge graph for approved requirements for the company
 * 3. Compare PR changes against requirement acceptance criteria
 * 4. Generate drift score (0-100: 100 = fully aligned, 0 = completely drifted)
 * 5. Post inline PR comments with requirement traceability
 * 6. Send drift alerts via notification channels
 */

class DriftAnalysisService {
  constructor() {
    this.commandCenterUrl = config.COMMAND_CENTER_API_URL || 'http://localhost:4000';
    this.monolithUrl = config.MONOLITH_API_URL || 'http://localhost:3001';
    this.strictThreshold = 70;
    this.looseThreshold = 40;
  }

  /**
   * Analyze a pull request for requirement drift
   * Called from webhook handler when pull_request event is received
   */
  async analyzePullRequest(prPayload, connection) {
    try {
      const { action, number, pull_request, repository } = prPayload;

      if (!['opened', 'synchronize', 'reopened'].includes(action)) {
        logger.info(`Drift: skipping PR action ${action} for #${number}`);
        return null;
      }

      const owner = repository.owner.login;
      const repo = repository.name;
      const prNumber = number;
      const companyId = connection.companyId;
      const userId = connection.userId;
      const orgId = connection.organizationId || connection.installationId;

      logger.info(`Drift: analyzing PR #${prNumber} in ${owner}/${repo} for company=${companyId}`);

      // Fetch PR diff
      const prDiff = await this.fetchPrDiff(userId, orgId, owner, repo, prNumber);

      // Fetch approved requirements for this company from Command Center
      const requirements = await this.fetchApprovedRequirements(companyId);

      // Fetch knowledge graph traceability
      const traceability = await this.fetchTraceabilityData(companyId);

      // Get project-specific drift threshold
      const threshold = await this.getDriftThreshold(companyId, repository.full_name);

      // Compute drift score
      const driftResult = this.computeDriftScore(prDiff, requirements, traceability, threshold);

      // Post PR comments with traceability
      await this.postDriftComments(userId, orgId, owner, repo, prNumber, driftResult);

      // Send drift notification
      await this.sendDriftNotification(companyId, driftResult, prPayload);

      logger.info(`Drift: PR #${prNumber} score=${driftResult.overallScore} status=${driftResult.driftStatus}`);

      return driftResult;
    } catch (error) {
      logger.error('Drift analysis error:', error);
      return {
        error: 'Drift analysis failed',
        message: error.message,
        overallScore: 0,
        driftStatus: 'analysis_failed'
      };
    }
  }

  /**
   * Fetch PR diff from GitHub via Octokit
   */
  async fetchPrDiff(userId, organizationId, owner, repo, prNumber) {
    try {
      const accessToken = await githubAuthService.getAccessToken(userId, organizationId);
      const Octokit = require('@octokit/rest').Octokit;
      const octokit = new Octokit({ auth: accessToken });

      const response = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: 'diff' }
      });

      const diffFiles = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber
      });

      return {
        diff: response.data,
        files: diffFiles.data.map(f => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
          patch: f.patch || ''
        })),
        title: '',
        body: '',
        totalAdditions: 0,
        totalDeletions: 0
      };
    } catch (error) {
      logger.error('Failed to fetch PR diff:', error);
      return { diff: '', files: [], title: '', body: '', totalAdditions: 0, totalDeletions: 0 };
    }
  }

  /**
   * Fetch approved requirements from Command Center knowledge graph
   * Queries CommandRequest API for spec_approved/dev_queue status
   */
  async fetchApprovedRequirements(companyId) {
    try {
      const response = await axios.get(`${this.monolithUrl}/api/v1/site-requests`, {
        params: {
          companyId,
          status: 'spec_approved,dev_queue,in_development',
          limit: 50
        },
        headers: {
          'X-Service-Name': 'flora-devops',
          'X-Drift-Bot': 'true',
          'Authorization': `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ''}`
        }
      });

      const requests = response.data?.data || response.data || [];
      return requests.map(req => ({
        id: req._id || req.id,
        ticketId: req.ticketId,
        requestText: req.requestText,
        requestType: req.requestType,
        status: req.status,
        priority: req.priority || req.extractedPriority || 'medium',
        tags: req.tags || [],
        acceptanceCriteria: req.aiAnalysis?.estimatedEffort || '',
        extractedEntities: req.extractedEntities || []
      }));
    } catch (error) {
      logger.error('Failed to fetch requirements for drift analysis:', error);
      return [];
    }
  }

  /**
   * Fetch traceability data from Command Center GraphQL
   * Returns requirement→code→test→deploy chains for the company
   */
  async fetchTraceabilityData(companyId) {
    try {
      const graphqlQuery = {
        query: `
          query GetTraceability($companyId: String!) {
            requirements(companyId: $companyId) {
              id
              ticketId
              text
              specifications {
                id
                acceptanceCriteria
              }
              code {
                id
                filename
                description
              }
              tests {
                id
                name
                status
              }
            }
          }
        `,
        variables: { companyId }
      };

      const response = await axios.post(
        `${this.commandCenterUrl}/graphql`,
        graphqlQuery,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Name': 'flora-devops',
            'X-Drift-Bot': 'true'
          }
        }
      );

      return response.data?.data?.requirements || [];
    } catch (error) {
      logger.warn('Traceability fetch failed (knowledge graph may not be deployed):', error.message);
      return [];
    }
  }

  /**
   * Compute drift score — compare PR changes against approved requirements
   *
   * Scoring methodology:
   * - Requirements with matching code changes in PR → aligned (high score)
   * - Requirements with no matching changes → potentially drifted (low score)
   * - PR changes not linked to any requirement → untracked code (drift risk)
   */
  computeDriftScore(prDiff, requirements, traceability, threshold) {
    const files = prDiff.files || [];
    const totalChanges = files.reduce((sum, f) => sum + f.changes, 0);

    if (totalChanges === 0 || requirements.length === 0) {
      return {
        overallScore: 100,
        driftStatus: 'no_data',
        alignedRequirements: [],
        driftedRequirements: [],
        untrackedChanges: [],
        threshold,
        filesAnalyzed: files.length,
        totalChanges,
        timestamp: new Date().toISOString()
      };
    }

    // Match PR files against requirement-linked code from traceability
    const alignedRequirements = [];
    const driftedRequirements = [];
    const untrackedChanges = [];

    const linkedFiles = new Set();
    if (traceability.length > 0) {
      for (const req of traceability) {
        if (req.code && req.code.length > 0) {
          for (const codeArtifact of req.code) {
            linkedFiles.add(codeArtifact.filename || codeArtifact.description || '');
          }
        }
      }
    }

    // Check each requirement against PR changes
    for (const req of requirements) {
      const reqTextLower = (req.requestText || '').toLowerCase();
      const reqTags = req.tags || [];
      const reqEntities = req.extractedEntities || [];

      // Find files in this PR that relate to this requirement
      const matchingFiles = files.filter(f => {
        const filenameLower = f.filename.toLowerCase();

        // Match by traceability link
        if (linkedFiles.has(f.filename)) return true;

        // Match by tag keyword in filename
        for (const tag of reqTags) {
          if (filenameLower.includes(tag.toLowerCase())) return true;
        }

        // Match by entity value in filename
        for (const entity of reqEntities) {
          if (entity.value && filenameLower.includes(entity.value.toLowerCase())) return true;
        }

        // Match by request text keyword overlap
        const keywords = reqTextLower.split(/\s+/).filter(w => w.length > 4);
        for (const keyword of keywords) {
          if (filenameLower.includes(keyword)) return true;
        }

        return false;
      });

      if (matchingFiles.length > 0) {
        alignedRequirements.push({
          requirementId: req.id,
          ticketId: req.ticketId,
          requestText: req.requestText,
          status: req.status,
          matchingFiles: matchingFiles.map(f => f.filename),
          alignmentScore: Math.min(100, (matchingFiles.length / files.length) * 100 * 5),
          totalChangesInMatch: matchingFiles.reduce((sum, f) => sum + f.changes, 0)
        });
      } else {
        driftedRequirements.push({
          requirementId: req.id,
          ticketId: req.ticketId,
          requestText: req.requestText,
          status: req.status,
          alignmentScore: 0,
          note: 'No code changes in this PR address this approved requirement'
        });
      }
    }

    // Find PR changes not linked to any requirement
    for (const file of files) {
      const isLinked = alignedRequirements.some(ar =>
        ar.matchingFiles.includes(file.filename)
      );

      if (!isLinked) {
        untrackedChanges.push({
          filename: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          status: file.status
        });
      }
    }

    // Compute overall drift score
    const alignedCount = alignedRequirements.length;
    const totalReqs = requirements.length;
    const untrackedRatio = untrackedChanges.length / files.length;

    let overallScore;
    if (totalReqs === 0) {
      overallScore = untrackedRatio > 0.5 ? 50 : 100;
    } else {
      const alignmentRatio = alignedCount / totalReqs;
      const untrackedPenalty = untrackedRatio * 30;
      overallScore = Math.round(alignmentRatio * 100 - untrackedPenalty);
      overallScore = Math.max(0, Math.min(100, overallScore));
    }

    const driftStatus = overallScore >= threshold
      ? 'aligned'
      : overallScore >= threshold * 0.7
      ? 'minor_drift'
      : 'significant_drift';

    return {
      overallScore,
      driftStatus,
      alignedRequirements,
      driftedRequirements,
      untrackedChanges,
      threshold,
      filesAnalyzed: files.length,
      totalChanges,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Post drift analysis comments on the GitHub PR
   * E2-US2: Inline comments with requirement traceability
   */
  async postDriftComments(userId, organizationId, owner, repo, prNumber, driftResult) {
    try {
      const { overallScore, driftStatus, alignedRequirements, driftedRequirements, untrackedChanges, threshold } = driftResult;

      const statusEmoji = driftStatus === 'aligned' ? '✅' : driftStatus === 'minor_drift' ? '⚠️' : '🔴';

      let commentBody = `## ${statusEmoji} Flora Drift Analysis\n\n`;
      commentBody += `**Drift Score:** ${overallScore}/100 (threshold: ${threshold})\n`;
      commentBody += `**Status:** ${driftStatus}\n\n`;

      if (alignedRequirements.length > 0) {
        commentBody += `### ✅ Aligned Requirements\n`;
        for (const req of alignedRequirements) {
          commentBody += `- **${req.ticketId}** — ${req.requestText.substring(0, 80)}${req.requestText.length > 80 ? '...' : ''}\n`;
          commentBody += `  Files: ${req.matchingFiles.join(', ')}\n`;
          commentBody += `  Alignment: ${req.alignmentScore}%\n`;
        }
        commentBody += '\n';
      }

      if (driftedRequirements.length > 0) {
        commentBody += `### ⚠️ Potentially Drifted Requirements\n`;
        for (const req of driftedRequirements) {
          commentBody += `- **${req.ticketId}** — ${req.requestText.substring(0, 80)}${req.requestText.length > 80 ? '...' : ''}\n`;
          commentBody += `  No code changes in this PR address this requirement.\n`;
        }
        commentBody += '\n';
      }

      if (untrackedChanges.length > 0) {
        commentBody += `### 🔍 Untracked Changes (no linked requirement)\n`;
        for (const change of untrackedChanges.slice(0, 10)) {
          commentBody += `- ${change.filename} (${change.additions}+ / ${change.deletions}-)\n`;
        }
        if (untrackedChanges.length > 10) {
          commentBody += `- ...and ${untrackedChanges.length - 10} more\n`;
        }
        commentBody += '\n';
      }

      commentBody += `---\n`;
      commentBody += `*Analysis by Flora Drift Bot · Powered by Flora Command Center Knowledge Graph*\n`;

      await githubIssueService.createComment(userId, organizationId, owner, repo, prNumber, commentBody);

      logger.info(`Drift: posted comment on PR #${prNumber} in ${owner}/${repo}`);
    } catch (error) {
      logger.error('Failed to post drift comment on PR:', error);
    }
  }

  /**
   * Send drift notification via existing notification channels
   * E2-US3: Slack/email notifications for drift alerts
   */
  async sendDriftNotification(companyId, driftResult, prPayload) {
    try {
      if (driftResult.driftStatus === 'aligned') {
        return; // No notification needed for aligned PRs
      }

      const { overallScore, driftStatus, driftedRequirements, threshold } = driftResult;
      const prNumber = prPayload.number;
      const prTitle = prPayload.pull_request?.title || '';
      const repoName = prPayload.repository?.full_name || '';
      const prUrl = prPayload.pull_request?.html_url || '';

      const notificationPayload = {
        companyId,
        type: 'drift_alert',
        priority: driftStatus === 'significant_drift' ? 'high' : 'medium',
        title: `Drift Alert: PR #${prNumber} in ${repoName}`,
        message: `PR "${prTitle}" has a drift score of ${overallScore}/100 (threshold: ${threshold}). ${driftedRequirements.length} approved requirements are not addressed by this PR.`,
        data: {
          prNumber,
          repoName,
          prUrl,
          driftScore: overallScore,
          driftStatus,
          threshold,
          driftedRequirements: driftedRequirements.map(r => ({
            ticketId: r.ticketId,
            requestText: r.requestText.substring(0, 100)
          }))
        }
      };

      // Send via monolith notification service
      await axios.post(`${this.monolithUrl}/api/v1/notifications`, notificationPayload, {
        headers: {
          'X-Service-Name': 'flora-devops',
          'X-Drift-Bot': 'true',
          'Authorization': `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ''}`
        }
      });

      logger.info(`Drift: sent notification for PR #${prNumber} score=${overallScore}`);
    } catch (error) {
      logger.warn('Failed to send drift notification:', error.message);
    }
  }

  /**
   * Get drift threshold for a specific project/repository
   * E2-US5: Per-project configurable drift sensitivity
   */
  async getDriftThreshold(companyId, repoFullName) {
    try {
      const response = await axios.get(`${this.monolithUrl}/api/v1/command-center/drift-config/${companyId}`, {
        params: { repo: repoFullName },
        headers: {
          'X-Service-Name': 'flora-devops',
          'Authorization': `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ''}`
        }
      });

      return response.data?.data?.threshold || this.strictThreshold;
    } catch (error) {
      // Default to strict threshold if no config exists
      return this.strictThreshold;
    }
  }

  /**
   * Get drift analysis history for a company
   */
  async getDriftHistory(companyId, options = {}) {
    try {
      const response = await axios.get(`${this.monolithUrl}/api/v1/command-center/drift-history/${companyId}`, {
        params: {
          limit: options.limit || 20,
          offset: options.offset || 0,
          status: options.driftStatus
        },
        headers: {
          'X-Service-Name': 'flora-devops',
          'Authorization': `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ''}`
        }
      });

      return response.data?.data || [];
    } catch (error) {
      logger.warn('Failed to fetch drift history:', error.message);
      return [];
    }
  }
}

module.exports = new DriftAnalysisService();
