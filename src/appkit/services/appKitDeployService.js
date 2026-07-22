const logger = require('../../config/logger');
const githubRepoService = require('../../integrations/github/services/githubRepoService');
const railwayService = require('../../integrations/railway/services/railwayService');
const vercelService = require('../../integrations/vercel/services/vercelService');

/**
 * App Kit Deploy Service
 *
 * Provisions the GitHub repo and the deploy-target hosting shell for a build,
 * reusing the existing GitHub/Railway/Vercel integration services as-is (see
 * FLORA_APP_KIT_ARCHITECTURE.md §8).
 *
 * `createGitHubRepo` and `provisionHostingShell` are exported separately
 * (rather than one combined `deploy()`) because phase 3 moved repo creation
 * out of the `deploying` step and into the start of `scaffolding` — the repo
 * has to exist before the template renderer can push anything into it. See
 * the ordering comment on `runPipeline` in `appKitBuildService.js` for the
 * full reasoning. `deploying` now only calls `provisionHostingShell`, against
 * a repo that was already created (and already has scaffolded + generated
 * source pushed to it) earlier in the pipeline.
 *
 * `provisionHostingShell` does NOT trigger a real first deployment — Railway/
 * Vercel need a build to run against, which is a further increment (out of
 * scope here); env vars are set so the *next* deploy has them. So `deployUrl`
 * on return is best-effort: a target may not expose one until a real deploy
 * happens, in which case it is null.
 */

function slugify(appName) {
  return String(appName)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'app-kit-app';
}

async function createGitHubRepo(build) {
  const name = slugify(build.appName);
  try {
    const repo = await githubRepoService.createRepository(build.userId, build.organizationId, {
      name,
      description: `Flora App Kit build: ${build.appName}`,
      private: true,
      autoInit: true
    });
    return repo;
  } catch (err) {
    // githubRepoService.createRepository wraps its whole try block — including
    // the connection lookup — in one catch that normalizes everything to a
    // generic AppError(message, status||500), so by here a missing GitHub
    // connection and an actual repo-creation failure (name collision, rate
    // limit, etc.) are no longer distinguishable. Don't assert a diagnosis we
    // can't confirm; the real cause is captured in the log line above.
    logger.error('App Kit deploy: GitHub repo creation failed', {
      buildId: build.buildId, error: err.message
    });
    throw new Error(
      `GitHub repository creation failed for this organization (no active GitHub connection, or the create-repository call itself failed): ${err.message}`
    );
  }
}

async function provisionRailway(build, appToken) {
  let connection;
  try {
    connection = await railwayService.getConnection(build.userId, build.organizationId);
  } catch (err) {
    logger.error('App Kit deploy: Railway connection lookup failed', {
      buildId: build.buildId, error: err.message
    });
    throw new Error(
      'No Railway connection found for this organization — connect Railway before requesting a Railway-targeted App Kit build.'
    );
  }
  const name = slugify(build.appName);

  const project = await railwayService.createProject(connection._id, {
    name,
    description: `Flora App Kit: ${build.appName}`,
    teamId: connection.teamId || undefined
  });

  const service = await railwayService.createService(connection._id, {
    projectId: project.id,
    name
  });

  if (appToken) {
    await railwayService.setEnvironmentVariables(connection._id, service.id, {
      APP_KIT_TOKEN: appToken
    });
  }

  // No build has been triggered (no source pushed yet), so Railway has not
  // minted a public URL for this service yet.
  return { deployUrl: null };
}

async function provisionVercel(build, appToken) {
  let connection;
  try {
    connection = await vercelService.getConnection(build.userId, build.organizationId);
  } catch (err) {
    logger.error('App Kit deploy: Vercel connection lookup failed', {
      buildId: build.buildId, error: err.message
    });
    throw new Error(
      'No Vercel connection found for this organization — connect Vercel before requesting a Vercel-targeted App Kit build.'
    );
  }
  const name = slugify(build.appName);

  const project = await vercelService.createProject(connection._id, { name });

  if (appToken) {
    await vercelService.createEnvironmentVariable(connection._id, project.id, {
      key: 'APP_KIT_TOKEN',
      value: appToken,
      type: 'encrypted',
      target: ['production', 'preview']
    });
  }

  // Vercel projects only get a deployment URL once a deployment exists;
  // we haven't pushed source or created one yet.
  return { deployUrl: null };
}

/**
 * Provision the deploy-target hosting shell (Railway project/service or
 * Vercel project) for a build whose GitHub repo already exists.
 *
 * @param {import('../models/AppKitBuild')} build
 * @param {string} [appToken] - raw scoped CC app token, in-memory only (never persisted)
 * @returns {Promise<{ deployUrl: string|null }>}
 */
async function provisionHostingShell(build, appToken) {
  let deployUrl = null;
  if (build.deployTarget === 'railway') {
    ({ deployUrl } = await provisionRailway(build, appToken));
  } else if (build.deployTarget === 'vercel') {
    ({ deployUrl } = await provisionVercel(build, appToken));
  } else {
    throw new Error(`Unsupported App Kit deploy target: ${build.deployTarget}`);
  }

  logger.info('App Kit hosting shell provisioned', {
    buildId: build.buildId, repo: build.repo, deployTarget: build.deployTarget
  });

  return { deployUrl };
}

module.exports = { createGitHubRepo, provisionHostingShell };
