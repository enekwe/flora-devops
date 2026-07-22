const logger = require('../../config/logger');
const githubRepoService = require('../../integrations/github/services/githubRepoService');
const template = require('../templates/v0');

/**
 * App Kit Scaffold Service
 *
 * Renders the opinionated template (FLORA_APP_KIT_ARCHITECTURE.md §8 phase 3)
 * and pushes the rendered files into the GitHub repo `appKitBuildService`
 * creates at the start of the `scaffolding` phase. See the ordering comment
 * on `runPipeline` in `appKitBuildService.js` for why repo creation moved
 * there instead of staying in `deploying`.
 */

/**
 * Render the full template file set for a build, in memory.
 * @param {import('../models/AppKitBuild')} build
 * @param {string} [generatedRouteBody] - code from appKitGenerateService to
 *   splice into the example route.
 * @returns {Array<{ path: string, content: string }>}
 */
function renderTemplate(build, generatedRouteBody) {
  return template.render(build, generatedRouteBody);
}

/**
 * Push rendered files into an already-created repo on a dedicated branch, then
 * open a PR back to the default branch — rather than committing straight to
 * the default branch as before. This is the hookup that makes
 * driftAnalysisService (already fully built, already wired to the `POST
 * /github` webhook on pull_request opened/synchronize/reopened) actually fire
 * for App Kit builds: nothing else in this pipeline ever opens a PR. The PR
 * is intentionally left open — no auto-merge (see FLORA_APP_KIT_ARCHITECTURE.md
 * §8 for why that's out of scope here).
 * @param {import('../models/AppKitBuild')} build
 * @param {string} repoFullName - "owner/repo"
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Promise<{ branch: string, prNumber: number, prUrl: string }>}
 */
async function pushFiles(build, repoFullName, files) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo full name for App Kit scaffold push: ${repoFullName}`);
  }

  const branchName = `app-kit/${build.buildId}`;
  const { baseBranch } = await githubRepoService.createBranch(
    build.userId,
    build.organizationId,
    owner,
    repo,
    branchName
  );

  for (const file of files) {
    await githubRepoService.createOrUpdateFile(
      build.userId,
      build.organizationId,
      owner,
      repo,
      file.path,
      file.content,
      `App Kit: add ${file.path} (build ${build.buildId})`,
      branchName
    );
  }

  const pr = await githubRepoService.createPullRequest(
    build.userId,
    build.organizationId,
    owner,
    repo,
    {
      title: `App Kit: ${build.appName}`,
      head: branchName,
      base: baseBranch,
      body: `Automated scaffold + generated source for App Kit build \`${build.buildId}\`.\n\n` +
        `Originating Command Center request: project \`${build.projectId}\`, request \`${build.requestId}\`.\n\n` +
        `This PR is intentionally left open — App Kit does not auto-merge. Drift analysis will comment here once it runs.`
    }
  );

  logger.info('App Kit scaffold pushed to branch, PR opened', {
    buildId: build.buildId,
    repo: repoFullName,
    branch: branchName,
    prNumber: pr.number,
    fileCount: files.length
  });

  return { branch: branchName, prNumber: pr.number, prUrl: pr.url };
}

module.exports = { renderTemplate, pushFiles };
