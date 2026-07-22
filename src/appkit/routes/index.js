const express = require('express');
const Joi = require('joi');
const router = express.Router();

const { validateRequest } = require('../../utils/validation');
const buildService = require('../services/appKitBuildService');

/**
 * Flora App Kit routes — mounted at /api/appkit
 *
 * The build-flow interface: the handoff by which a Command Center project request
 * enters the devops delivery plane (see FLORA_APP_KIT_ARCHITECTURE.md §4).
 */

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/);

const createBuildSchema = Joi.object({
  // Command Center linkage
  projectId: Joi.string().required(),
  requestId: Joi.string().required(),

  // Multi-tenant identifiers
  userId: objectId.required(),
  organizationId: objectId.required(),
  companyId: objectId.optional(),

  // What to build
  appName: Joi.string().max(120).required(),
  prompt: Joi.string().max(10000).required(),

  // Capability manifest (the hard boundary). Fully validated in the manifest service.
  manifest: Joi.object({
    dataScopes: Joi.array().items(Joi.object({
      resource: Joi.string().required(),
      id: Joi.string().optional(),
      access: Joi.string().valid('read', 'write').default('read')
    })).default([]),
    systems: Joi.array().items(Joi.string()).default([]),
    egress: Joi.array().items(Joi.string()).default([])
  }).default({}),

  deployTarget: Joi.string().valid('railway', 'vercel').optional(),
  callbackUrl: Joi.string().uri().optional()
});

/**
 * POST /api/appkit/builds
 * Kick off a custom-app build. Returns immediately with the buildId; the pipeline
 * advances asynchronously and reports each phase back to callbackUrl.
 */
router.post('/builds', validateRequest(createBuildSchema), async (req, res, next) => {
  try {
    const build = await buildService.createBuild(req.body);
    res.status(202).json({
      success: true,
      buildId: build.buildId,
      status: 'accepted',
      phase: build.phase
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/appkit/builds/:buildId
 * Read current phase, drift score, deploy URL, and repo for a build.
 */
router.get('/builds/:buildId', async (req, res, next) => {
  try {
    const build = await buildService.getBuild(req.params.buildId);
    if (!build) {
      return res.status(404).json({ success: false, message: 'Build not found' });
    }
    res.json({ success: true, build });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/appkit/builds?organizationId=&projectId=&limit=
 * List builds for a tenant / project.
 */
router.get('/builds', async (req, res, next) => {
  try {
    const builds = await buildService.listBuilds({
      organizationId: req.query.organizationId,
      projectId: req.query.projectId,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined
    });
    res.json({ success: true, count: builds.length, builds });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
