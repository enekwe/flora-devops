const Joi = require('joi');

/**
 * App Kit Manifest Service
 *
 * The capability manifest is the hard data-access boundary for a built app
 * (see FLORA_APP_KIT_ARCHITECTURE.md §5). This service validates and normalizes
 * a manifest at build-request time and exposes the helpers the runtime broker
 * uses to decide whether a given operation is permitted.
 *
 * Enforcement itself happens in Command Center's data broker; this service is the
 * single definition of the manifest shape and the allow-check both planes agree on.
 */

// Operations the broker can proxy, mapped to the manifest resource + access they
// require. Keep in sync with Command Center's appKitBrokerService.OP_REQUIREMENTS.
const OP_REQUIREMENTS = {
  getCompany: { resource: 'company', access: 'read' },
  updateCompany: { resource: 'company', access: 'write' },
  getSite: { resource: 'site', access: 'read' },
  updateSite: { resource: 'site', access: 'write' },
  incrementSiteMetrics: { resource: 'site.metrics', access: 'write' },
  getUser: { resource: 'user', access: 'read' },
  createNotification: { resource: 'notifications', access: 'write', system: 'notifications' },
  checkMilestones: { resource: 'milestones', access: 'write' }
};

const dataScopeSchema = Joi.object({
  resource: Joi.string().required(),
  id: Joi.string().optional(),
  access: Joi.string().valid('read', 'write').default('read')
});

const manifestSchema = Joi.object({
  dataScopes: Joi.array().items(dataScopeSchema).default([]),
  systems: Joi.array().items(Joi.string()).default([]),
  egress: Joi.array().items(Joi.string().hostname()).default([])
});

/**
 * Validate + normalize a manifest. Throws a 400-tagged error on failure.
 * @returns {object} normalized manifest
 */
function normalize(manifest) {
  const { error, value } = manifestSchema.validate(manifest || {}, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const err = new Error('Invalid App Kit manifest');
    err.statusCode = 400;
    err.errors = error.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message
    }));
    throw err;
  }

  return value;
}

/**
 * Does this manifest permit `op` against `resourceId`?
 * Used by the runtime broker to enforce the hard boundary.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function isOperationAllowed(manifest, op, resourceId) {
  const req = OP_REQUIREMENTS[op];
  if (!req) {
    return { allowed: false, reason: `Unknown operation: ${op}` };
  }

  // System-gated operations must have the system declared.
  if (req.system && !(manifest.systems || []).includes(req.system)) {
    return { allowed: false, reason: `System '${req.system}' not declared in manifest` };
  }

  const scope = (manifest.dataScopes || []).find((s) => {
    if (s.resource !== req.resource) return false;
    if (s.id && resourceId && s.id !== resourceId) return false; // scoped to a specific id
    return true;
  });

  if (!scope) {
    return { allowed: false, reason: `Resource '${req.resource}' not declared in manifest` };
  }

  if (req.access === 'write' && scope.access !== 'write') {
    return { allowed: false, reason: `Manifest grants only read on '${req.resource}'` };
  }

  return { allowed: true };
}

module.exports = {
  OP_REQUIREMENTS,
  normalize,
  isOperationAllowed
};
