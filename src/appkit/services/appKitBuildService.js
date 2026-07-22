const crypto = require('crypto');
const axios = require('axios');
const config = require('../../config');
const logger = require('../../config/logger');
const AppKitBuild = require('../models/AppKitBuild');
const manifestService = require('./appKitManifestService');
const deployService = require('./appKitDeployService');
const scaffoldService = require('./appKitScaffoldService');
const generateService = require('./appKitGenerateService');
const integrityService = require('./appKitIntegrityService');

/**
 * App Kit Build Service
 *
 * Orchestrates the devops-side build lifecycle:
 *   accepted -> scaffolding -> generating -> integrity_testing -> deploying -> tracking -> live
 * with `blocked` (failed integrity tests) and `failed` (pipeline error) as off-ramps.
 *
 * This is the state machine + Command Center callback wiring, and it now drives
 * the real phase effects too: rendering the opinionated template
 * (`appKitScaffoldService`), calling the CC provider brain to generate code
 * (`appKitGenerateService`), the static manifest-conformance integrity gate
 * (`appKitIntegrityService`), and shipping via the existing GitHub +
 * Railway/Vercel services (`appKitDeployService`) — see
 * FLORA_APP_KIT_ARCHITECTURE.md §8 for the phasing and `runPipeline` below for
 * the repo-creation ordering decision.
 */

/**
 * POST a phase transition back to the Command Center project timeline.
 * Best-effort: a callback failure must not crash the build.
 */
async function postCallback(build) {
  if (!build.callbackUrl) return;

  const payload = {
    buildId: build.buildId,
    projectId: build.projectId,
    requestId: build.requestId,
    phase: build.phase,
    driftScore: build.driftScore,
    driftStatus: build.driftStatus,
    deployUrl: build.deployUrl,
    repo: build.repo,
    error: build.error
  };

  try {
    await axios.post(build.callbackUrl, payload, {
      timeout: 10000,
      headers: { 'X-Service-Name': config.SERVICE_NAME }
    });
    logger.info('App Kit callback delivered', { buildId: build.buildId, phase: build.phase });
  } catch (err) {
    logger.warn('App Kit callback failed (non-fatal)', {
      buildId: build.buildId,
      phase: build.phase,
      error: err.message
    });
  }
}

/**
 * Advance a build to a new phase, persist, and notify Command Center.
 */
async function advance(build, phase, detail) {
  build.setPhase(phase, detail);
  await build.save();
  await postCallback(build);
  return build;
}

/**
 * Request a scoped app token from Command Center for a build entering `deploying`.
 * The token carries the manifest scopes AND lets CC classify the app's own ZDR
 * trust tier from `deployTarget` (Railway/Vercel = standard_hosted, not
 * self_hosted) — that classification is what allows CC's broker to deny ZDR
 * tenants' data to apps hosted on public-cloud PaaS. See appKitTokenService on
 * the Command Center side.
 *
 * The raw token is never persisted here — only its `jti`, for traceability and
 * so a failed/blocked build can be revoked. The token itself is meant to be
 * injected into the deployed app's environment at deploy time.
 */
async function requestScopedToken(build) {
  const url = `${config.COMMAND_CENTER_API_URL}/api/command-center/appkit/tokens`;

  const response = await axios.post(url, {
    buildId: build.buildId,
    projectId: build.projectId,
    requestId: build.requestId,
    organizationId: String(build.organizationId),
    userId: String(build.userId),
    companyId: build.companyId ? String(build.companyId) : undefined,
    deployTarget: build.deployTarget,
    scope: {
      dataScopes: build.manifest?.dataScopes || [],
      systems: build.manifest?.systems || []
    }
  }, {
    timeout: 10000,
    headers: {
      'X-Service-Name': config.SERVICE_NAME,
      ...(process.env.APP_KIT_SERVICE_KEY ? { 'X-API-Key': process.env.APP_KIT_SERVICE_KEY } : {})
    }
  });

  build.appTokenJti = response.data?.jti;
  await build.save();

  logger.info('App Kit scoped token issued by Command Center', {
    buildId: build.buildId, jti: build.appTokenJti
  });

  return response.data;
}

/**
 * Revoke a build's scoped token(s) in Command Center — called when a build
 * fails after a token was already minted, so a broken/abandoned build cannot
 * retain live data access.
 */
async function revokeScopedToken(build) {
  if (!build.appTokenJti) return; // nothing was ever minted
  const url = `${config.COMMAND_CENTER_API_URL}/api/command-center/appkit/tokens/${build.buildId}`;
  try {
    await axios.delete(url, {
      timeout: 10000,
      headers: {
        'X-Service-Name': config.SERVICE_NAME,
        ...(process.env.APP_KIT_SERVICE_KEY ? { 'X-API-Key': process.env.APP_KIT_SERVICE_KEY } : {})
      }
    });
    logger.info('App Kit scoped token revoked after failure', { buildId: build.buildId });
  } catch (err) {
    logger.error('App Kit scoped token revoke failed (non-fatal)', {
      buildId: build.buildId, error: err.message
    });
  }
}

/**
 * Create a build from a validated request and enter the pipeline.
 *
 * @param {object} input - already Joi-validated by the route
 * @returns {Promise<AppKitBuild>}
 */
async function createBuild(input) {
  const manifest = manifestService.normalize(input.manifest);

  const build = await AppKitBuild.create({
    buildId: `akb_${crypto.randomUUID()}`,
    projectId: input.projectId,
    requestId: input.requestId,
    userId: input.userId,
    organizationId: input.organizationId,
    companyId: input.companyId,
    appName: input.appName,
    prompt: input.prompt,
    manifest,
    callbackUrl: input.callbackUrl,
    templateVersion: config.APP_KIT_TEMPLATE_VERSION,
    deployTarget: input.deployTarget || config.APP_KIT_DEFAULT_DEPLOY_TARGET,
    phase: 'accepted',
    phaseHistory: [{ phase: 'accepted', detail: 'Build request accepted', at: new Date() }]
  });

  logger.info('App Kit build accepted', {
    buildId: build.buildId,
    projectId: build.projectId,
    appName: build.appName
  });

  await postCallback(build);

  // Enter the pipeline asynchronously — the caller gets an immediate 202-style
  // response with the buildId while the build proceeds.
  runPipeline(build).catch((err) => {
    logger.error('App Kit pipeline error', { buildId: build.buildId, error: err.message });
  });

  return build;
}

/**
 * Drive the build through its phases.
 *
 * Repo-creation ordering (FLORA_APP_KIT_ARCHITECTURE.md §8 phase 3): the repo
 * used to be created inside `deploying` (appKitDeployService.deploy), but
 * nothing existed to push into it until the template renderer landed here —
 * and the repo must exist *before* `scaffolding`/`generating`/
 * `integrity_testing` can push anything. Rather than juggle repo state across
 * phase boundaries, the repo is now created once, at the very start of
 * `scaffolding` (`deployService.createGitHubRepo`), and the rendered files are
 * held in memory (`files`, local to this function — the whole pipeline is one
 * continuous async call, so there's no need to persist intermediate artifacts
 * to Mongo) through `generating` and `integrity_testing`. Files are pushed to
 * the repo (`scaffoldService.pushFiles`) only once `integrity_testing` has
 * actually passed, immediately before `deploying` — so a `blocked` build never
 * gets non-manifest-conforming generated code pushed to the user's GitHub at
 * all. `deploying` is left doing only what it can meaningfully do at that
 * point: provisioning the hosting shell (Railway/Vercel project + env vars)
 * against a repo that already has real source in it.
 */
async function runPipeline(build) {
  try {
    await advance(build, 'scaffolding', 'Creating repo and rendering opinionated template');
    const repo = await deployService.createGitHubRepo(build);
    build.repo = repo.fullName;
    await build.save();

    await advance(build, 'generating', 'Generating app code via Command Center provider brain');
    const generated = await generateService.generate(build);
    const files = scaffoldService.renderTemplate(build, generated.code);

    await advance(build, 'integrity_testing', 'Running static manifest-conformance check');
    const integrity = integrityService.checkManifestConformance(build.manifest, files);
    if (!integrity.allowed) {
      build.error = integrity.reason;
      await advance(build, 'blocked', integrity.reason);
      logger.warn('App Kit build blocked by static integrity check', {
        buildId: build.buildId, op: integrity.op, calledOps: integrity.calledOps
      });
      return; // no deploy — Block's "quietly wrong" guard
    }

    await scaffoldService.pushFiles(build, build.repo, files);

    await advance(build, 'deploying', `Deploying via ${build.deployTarget}`);
    const scopedToken = await requestScopedToken(build);
    // Raw token lives only in this local variable, never persisted to Mongo
    // (build.appTokenJti is the only DB-side reference); it's threaded straight
    // into the hosting-shell call so it can be injected into the new service's env.
    const { deployUrl } = await deployService.provisionHostingShell(build, scopedToken?.token);
    build.deployUrl = deployUrl;

    await advance(build, 'tracking', 'Deployed; awaiting drift analysis + deploy webhooks');
    // TODO(appkit-phase-4): driftAnalysisService gate is still not wired here.
    //   It can now score a real, requirements-mapped diff (the repo has
    //   scaffolded + generated source as of the push above), so this is a
    //   reasonable next increment rather than a blocker. Also still pending:
    //   real dynamic test execution — actually running the template's Jest
    //   suite — via the .github/workflows/ci.yml this build's scaffold ships;
    //   that's async/webhook-driven (a CI run reporting back into
    //   `integrity_testing` or a post-deploy gate) rather than run in-process
    //   here, deliberately, to avoid executing LLM-generated code inside this
    //   live server.

    logger.info('App Kit pipeline reached tracking (skeleton stops here)', {
      buildId: build.buildId
    });
  } catch (err) {
    build.error = err.message;
    await advance(build, 'failed', `Pipeline error: ${err.message}`);
    await revokeScopedToken(build);
    throw err;
  }
}

async function getBuild(buildId) {
  return AppKitBuild.findOne({ buildId });
}

async function listBuilds({ organizationId, projectId, limit = 20 }) {
  const query = {};
  if (organizationId) query.organizationId = organizationId;
  if (projectId) query.projectId = projectId;
  return AppKitBuild.find(query).sort({ createdAt: -1 }).limit(Math.min(limit, 100));
}

module.exports = {
  createBuild,
  advance,
  getBuild,
  listBuilds,
  postCallback
};
