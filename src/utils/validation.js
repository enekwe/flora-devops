const Joi = require('joi');

// Common validation schemas
const schemas = {
  objectId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  optionalObjectId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),

  // Multi-tenant identifiers
  multiTenant: Joi.object({
    userId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    organizationId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  }),

  // GitHub
  githubRepo: Joi.object({
    name: Joi.string().required(),
    description: Joi.string().allow(''),
    private: Joi.boolean().default(false),
    autoInit: Joi.boolean().default(false),
  }),

  githubIssue: Joi.object({
    title: Joi.string().required(),
    body: Joi.string().allow(''),
    assignees: Joi.array().items(Joi.string()),
    labels: Joi.array().items(Joi.string()),
    milestone: Joi.number(),
  }),

  // Vercel (Coming Soon)
  vercelDeployment: Joi.object({
    projectId: Joi.string().required(),
    gitSource: Joi.object({
      type: Joi.string().valid('github').required(),
      repo: Joi.string().required(),
      ref: Joi.string(),
    }),
  }),

  // Webhook
  webhook: Joi.object({
    url: Joi.string().uri().required(),
    events: Joi.array().items(Joi.string()).min(1).required(),
    secret: Joi.string(),
    active: Joi.boolean().default(true),
  }),
};

/**
 * Validate request data against a schema
 * @param {Object} data - Data to validate
 * @param {Object} schema - Joi schema
 * @returns {Object} Validated data
 * @throws {Error} Validation error
 */
function validate(data, schema) {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
    }));
    const validationError = new Error('Validation failed');
    validationError.errors = errors;
    validationError.statusCode = 400;
    throw validationError;
  }

  return value;
}

/**
 * Express middleware for request validation
 * @param {Object} schema - Joi schema
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 */
function validateRequest(schema, property = 'body') {
  return (req, res, next) => {
    try {
      req[property] = validate(req[property], schema);
      next();
    } catch (error) {
      res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
        errors: error.errors,
      });
    }
  };
}

module.exports = {
  schemas,
  validate,
  validateRequest,
};
