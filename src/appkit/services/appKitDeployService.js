const logger = require('../../config/logger');
const githubRepoService = require('../../integrations/github/services/githubRepoService');
const GitHubConnection = require('../../integrations/github/models/GitHubConnection');
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
 * `provisionHostingShell` now also links the App Kit PR branch (created by
 * `appKitScaffoldService.pushFiles`) as the hosting target's git source and
 * triggers a real first build against it — a *preview* deploy, deliberately,
 * since the PR from item 2 is left open rather than merged to the default
 * branch. Neither platform is exercised against a live account in this
 * session (no credentials/network here) — the code path is wired against
 * each platform's documented, publicly-verified request/mutation shape, but
 * is not execute-tested end to end. See `provisionRailway`/`provisionVercel`
 * for the per-platform caveats. `deployUrl` on return is still best-effort:
 * Railway in particular does not hand back a public URL synchronously from
 * `serviceCreate`/`triggerDeployment`, so it stays null there until a
 * `deployment`/`deployment_status` webhook reports one.
 */

function slugify(appName) {
  return String(appName)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'app-kit-app';
}

/**
 * Register the newly created repo on the org's GitHubConnection so it's
 * discoverable later (webhooks/routes.js#findConnectionForRepo, which
 * driftAnalysisService's PR-webhook gate depends on to resolve a repo back to
 * a company/user/org). `githubRepoService.createRepository` itself does not
 * register the repo anywhere — only `listRepositories()` does that, via
 * `connection.addRepository()`, and only for a full resync.
 *
 * Deliberately uses `addMonitoredRepository(repoId)`, not `addRepository()`:
 * `addRepository()` pushes onto `connection.repositories`, a field
 * `findConnectionForRepo` never reads, so calling it would create the
 * illusion of registration without actually making anything discoverable.
 * `monitoredRepositories` is the field that query actually checks, and
 * "monitored" is the semantically correct bucket for a repo App Kit is about
 * to open PRs against for drift tracking.
 *
 * Non-fatal: failing to register must not fail a build whose GitHub repo
 * already exists — this is bookkeeping for a later phase, not a build
 * prerequisite.
 */
async function registerRepoOnConnection(build, repo) {
  try {
    const connection = await GitHubConnection.findOne({
      userId: build.userId,
      organizationId: build.organizationId
    });
    if (!connection) {
      logger.warn('App Kit deploy: no GitHubConnection found to register repo on (non-fatal)', {
        buildId: build.buildId, repo: repo.fullName
      });
      return;
    }
    await connection.addMonitoredRepository(repo.id);
    logger.info('App Kit deploy: repo registered as monitored on GitHubConnection', {
      buildId: build.buildId, repo: repo.fullName
    });
  } catch (err) {
    logger.warn('App Kit deploy: failed to register repo on GitHubConnection (non-fatal)', {
      buildId: build.buildId, repo: repo.fullName, error: err.message
    });
  }
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
    await registerRepoOnConnection(build, repo);
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

  // `source` links the App Kit repo at service-creation time so Railway can
  // build from it. Shape (`source: { repo: "owner/repo" }`) is per Railway's
  // publicly documented GraphQL mutation for serviceCreate — this session has
  // no Railway API token, so schema introspection (the only way to get an
  // authoritative field list) wasn't possible; the public docs page for the
  // Public API didn't expose the ServiceSourceInput field list either. This
  // is the best-documented shape available, not one verified against a live
  // call. Also unverified: whether `serviceCreate` can pin a specific branch
  // at creation time — the App Kit repo's default branch is what auto-init
  // created (usually main/master), not the PR branch from item 2. Pinning the
  // deploy to that PR branch specifically would need a further Railway API
  // call this session couldn't identify with confidence; flagging that as a
  // follow-up rather than guessing at an unconfirmed mutation.
  //
  // GraphQL rejects the WHOLE mutation if a field doesn't exist on the input
  // type — an unknown `source`/`ServiceSourceInput` shape would fail
  // service creation entirely, regressing what worked before this change
  // (a service with no git link). Since that shape is genuinely unverified,
  // try it first but fall back to plain creation (no source) rather than let
  // a wrong guess about Railway's schema break every Railway-targeted build.
  let service;
  try {
    service = await railwayService.createService(connection._id, {
      projectId: project.id,
      name,
      source: build.repo ? { repo: build.repo } : undefined
    });
  } catch (err) {
    if (!build.repo) throw err; // no source was attempted; a real failure either way
    logger.warn('App Kit deploy: Railway createService with source failed, retrying without git link', {
      buildId: build.buildId, error: err.message
    });
    service = await railwayService.createService(connection._id, { projectId: project.id, name });
  }

  if (appToken) {
    await railwayService.setEnvironmentVariables(connection._id, service.id, {
      APP_KIT_TOKEN: appToken
    });
  }

  // Now that the service has a git source, trigger a real first build
  // (previously nothing ever called this — railwayService.triggerDeployment
  // already existed but was unused by App Kit). This is a preview-style
  // first deploy: the PR from item 2 is intentionally left unmerged, so
  // whatever branch Railway's source resolves to is not `main` in the
  // "already reviewed and merged" sense.
  try {
    await railwayService.triggerDeployment(connection._id, service.id);
  } catch (err) {
    // Provisioning succeeded even if the trigger didn't — don't fail the
    // whole build over a deploy-trigger hiccup; `tracking` phase / deploy
    // webhooks are where deploy health actually gets watched.
    logger.error('App Kit deploy: Railway triggerDeployment failed (non-fatal — service still provisioned)', {
      buildId: build.buildId, serviceId: service.id, error: err.message
    });
  }

  // Railway does not hand back a public URL synchronously from
  // serviceCreate/triggerDeployment; it arrives later via deploy webhooks.
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

  // `gitRepository` links the App Kit repo at project-creation time. Shape
  // confirmed against Vercel's public REST API reference for
  // `POST /v9/projects` (request body: `gitRepository: { type, repo }`,
  // `repo` as "owner/repo", `type: 'github'`) — this one *is* documented
  // precisely enough to be confident of the shape, unlike Railway's. Note
  // the endpoint does not accept a branch here; branch targeting happens at
  // deployment time below via `gitSource.ref`.
  //
  // Same defensive posture as Railway even though confidence is higher here:
  // this session never called the real Vercel API, so fall back to a plain
  // project (no git link) rather than let any shape mismatch regress project
  // creation itself, which worked before this change.
  let project;
  try {
    project = await vercelService.createProject(connection._id, {
      name,
      ...(build.repo ? { gitRepository: { type: 'github', repo: build.repo } } : {})
    });
  } catch (err) {
    if (!build.repo) throw err;
    logger.warn('App Kit deploy: Vercel createProject with gitRepository failed, retrying without git link', {
      buildId: build.buildId, error: err.message
    });
    project = await vercelService.createProject(connection._id, { name });
  }

  if (appToken) {
    await vercelService.createEnvironmentVariable(connection._id, project.id, {
      key: 'APP_KIT_TOKEN',
      value: appToken,
      type: 'encrypted',
      target: ['production', 'preview']
    });
  }

  let deployUrl = null;
  if (build.repo && build.branch) {
    // Trigger a real first (preview) build against the PR branch from item 2
    // — this is what makes `deploying` actually deploy something, rather
    // than stop at a provisioned-but-empty project. `gitSource` shape (type,
    // org, repo, ref) confirmed against Vercel's public REST API reference
    // for `POST /v13/deployments`; `target` is left unset because the docs
    // say an omitted target defaults to `preview`, which is exactly what an
    // unmerged-PR-branch deploy should be. Not executed against a live
    // Vercel account in this session — no credentials/network here.
    const [org, repo] = build.repo.split('/');
    try {
      const deployment = await vercelService.createDeployment(connection._id, {
        name,
        project: project.id,
        gitSource: { type: 'github', org, repo, ref: build.branch }
      });
      deployUrl = deployment.url ? `https://${deployment.url}` : null;
    } catch (err) {
      // Same reasoning as the Railway trigger failure above: provisioning
      // already succeeded, so don't fail the build over the deploy trigger.
      logger.error('App Kit deploy: Vercel createDeployment failed (non-fatal — project still provisioned)', {
        buildId: build.buildId, projectId: project.id, error: err.message
      });
    }
  }

  return { deployUrl };
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
