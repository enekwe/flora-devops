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
 * Push rendered files into an already-created repo, one commit per file via
 * Octokit's createOrUpdateFileContents (githubRepoService.createOrUpdateFile).
 * @param {import('../models/AppKitBuild')} build
 * @param {string} repoFullName - "owner/repo"
 * @param {Array<{ path: string, content: string }>} files
 */
async function pushFiles(build, repoFullName, files) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo full name for App Kit scaffold push: ${repoFullName}`);
  }

  for (const file of files) {
    await githubRepoService.createOrUpdateFile(
      build.userId,
      build.organizationId,
      owner,
      repo,
      file.path,
      file.content,
      `App Kit: add ${file.path} (build ${build.buildId})`
    );
  }

  logger.info('App Kit scaffold pushed to repo', {
    buildId: build.buildId,
    repo: repoFullName,
    fileCount: files.length
  });
}

module.exports = { renderTemplate, pushFiles };
