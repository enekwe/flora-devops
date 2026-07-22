const axios = require('axios');
const config = require('../../config');
const logger = require('../../config/logger');

/**
 * App Kit Generate Service
 *
 * Calls Command Center's provider brain to fill in the opinionated template's
 * example route (FLORA_APP_KIT_ARCHITECTURE.md §8 phase 2/3).
 *
 * Command Center's real response shape (see flora-command-center's
 * appKitCodeGenService.js, verified against the committed code — not a
 * guess): `{ success, files: [{path, content}], parsed, raw, model, usage,
 * cost }`. `files` is ALWAYS present and non-empty on success — even when the
 * model didn't return valid structured JSON, CC falls back to a single
 * synthetic file wrapping the raw text, so `files` is the one field safe to
 * trust. `raw` is the model's full *unprocessed* text — when `parsed` is
 * true this is the JSON blob the skill prompt asked for, not usable source by
 * itself, so it must never be preferred over `files`. `extractGeneratedCode`
 * checks `files` first for exactly that reason; `code`/`content`/nested
 * `data` fields are kept only as defensive fallbacks in case the endpoint's
 * shape changes later, and `raw` is checked last, not first.
 */

async function generate(build) {
  const url = `${config.COMMAND_CENTER_API_URL}/api/command-center/appkit/generate`;

  let response;
  try {
    response = await axios.post(
      url,
      {
        buildId: build.buildId,
        appName: build.appName,
        prompt: build.prompt,
        manifest: build.manifest
      },
      {
        timeout: 30000,
        headers: {
          'X-Service-Name': config.SERVICE_NAME,
          ...(process.env.APP_KIT_SERVICE_KEY ? { 'X-API-Key': process.env.APP_KIT_SERVICE_KEY } : {})
        }
      }
    );
  } catch (err) {
    logger.error('App Kit generate: Command Center call failed', {
      buildId: build.buildId,
      error: err.message
    });
    throw new Error(
      `App Kit code generation failed (Command Center provider brain unreachable or errored): ${err.message}`
    );
  }

  const code = extractGeneratedCode(response.data);
  if (!code) {
    logger.warn('App Kit generate: response had no recognizable code field, using placeholder route', {
      buildId: build.buildId,
      responseShape: describeShape(response.data)
    });
  }

  return { code, raw: response.data };
}

/**
 * Extract generated source from Command Center's response. Priority order
 * matters: `files` first (CC's real, structured, always-populated-on-success
 * field), THEN the defensive `code`/`content` fallbacks, and `raw` LAST —
 * `raw` is the model's unprocessed text and, when CC's `parsed` flag is true,
 * is literally the `{"files":[...]}` JSON blob the skill prompt requested,
 * not source code. Preferring it over `files` would splice a JSON dump into
 * the generated route instead of real application code.
 * @returns {string} generated code, or '' if nothing usable was found
 */
function extractGeneratedCode(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return '';

  if (Array.isArray(data.files) && data.files.length > 0) {
    const main =
      data.files.find((f) => f && typeof f.content === 'string' && /index\.js|route/i.test(f.path || '')) ||
      data.files.find((f) => f && typeof f.content === 'string');
    if (main) return main.content;
  }

  for (const field of ['code', 'content']) {
    if (typeof data[field] === 'string' && data[field].trim()) {
      return data[field];
    }
  }

  if (data.data && data.data !== data) {
    return extractGeneratedCode(data.data);
  }

  // Last resort: raw model text. Only usable when CC did NOT parse it into
  // files (data.parsed === false means the model's response wasn't JSON at
  // all, so `raw` may genuinely be free-form text/code rather than a JSON blob).
  if (data.parsed === false && typeof data.raw === 'string' && data.raw.trim()) {
    return data.raw;
  }

  return '';
}

function describeShape(data) {
  if (!data) return typeof data;
  if (typeof data !== 'object') return typeof data;
  return Object.keys(data);
}

module.exports = { generate, extractGeneratedCode };
