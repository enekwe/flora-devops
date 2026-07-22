const manifestService = require('./appKitManifestService');

/**
 * App Kit Integrity Service
 *
 * The v0 `integrity_testing` gate (FLORA_APP_KIT_ARCHITECTURE.md §8 phase 3):
 * a static manifest-conformance check, not real dynamic test execution.
 * Actually running the template's Jest suite would mean executing
 * LLM-generated, attacker-influenceable code inside this live server process
 * (child_process/npm install) — a code-execution-surface decision out of
 * scope here; see the pending item flagged in the architecture doc for the
 * CI-driven alternative. Instead this scans the rendered source for every
 * `callAppKit('op', ...)` the generated code actually calls and cross-checks
 * each one against the build's declared manifest via
 * `appKitManifestService.isOperationAllowed` — the same allow-check the
 * runtime Command Center broker enforces. Any call the manifest does not
 * cover blocks the build before it ever reaches `deploying`.
 */

const CALL_PATTERN = /callAppKit\(\s*['"]([a-zA-Z][a-zA-Z0-9_]*)['"]/g;

/**
 * Extract every distinct `op` the source files call `callAppKit(...)` with.
 * @param {Array<{ path: string, content: string }>} sourceFiles
 * @returns {string[]}
 */
function extractCalledOps(sourceFiles) {
  const ops = new Set();
  for (const file of sourceFiles || []) {
    const content = file?.content || '';
    CALL_PATTERN.lastIndex = 0;
    let match;
    while ((match = CALL_PATTERN.exec(content)) !== null) {
      ops.add(match[1]);
    }
  }
  return [...ops];
}

/**
 * Check that every scoped-client op the generated code calls is permitted by
 * the build's manifest.
 * @param {object} manifest - build.manifest
 * @param {Array<{ path: string, content: string }>} sourceFiles - rendered
 *   template files (includes the generated code already spliced in)
 * @returns {{ allowed: boolean, op?: string, reason?: string, calledOps: string[] }}
 */
function checkManifestConformance(manifest, sourceFiles) {
  const calledOps = extractCalledOps(sourceFiles);

  for (const op of calledOps) {
    const verdict = manifestService.isOperationAllowed(manifest, op);
    if (!verdict.allowed) {
      return {
        allowed: false,
        op,
        calledOps,
        reason: `Generated code calls callAppKit('${op}') which the manifest does not permit: ${verdict.reason}`
      };
    }
  }

  return { allowed: true, calledOps };
}

module.exports = { extractCalledOps, checkManifestConformance };
