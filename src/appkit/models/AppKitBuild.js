const mongoose = require('mongoose');

/**
 * AppKitBuild
 *
 * Lifecycle record for a single Flora App Kit build. A build is created when a
 * Command Center project classifies a natural-language request as a "custom app"
 * and hands it to the devops delivery plane (see FLORA_APP_KIT_ARCHITECTURE.md §4).
 *
 * The build record is the devops-side state machine. Command Center remains the
 * project / audit system of record; each phase transition is POSTed back to the
 * project via `callbackUrl`.
 */

// The lifecycle phases, in order. `blocked` (failed integrity tests) and
// `failed` (pipeline error) are terminal off-ramps.
const PHASES = [
  'accepted',
  'scaffolding',
  'generating',
  'integrity_testing',
  'deploying',
  'tracking',
  'live',
  'blocked',
  'failed'
];

// A single declared data scope — the hard boundary an app may not exceed at runtime.
const dataScopeSchema = new mongoose.Schema({
  resource: { type: String, required: true },          // e.g. 'company', 'site.metrics'
  id: { type: String },                                // optional specific resource id
  access: { type: String, enum: ['read', 'write'], default: 'read' }
}, { _id: false });

// The capability manifest — declared up front, enforced by the CC data broker.
const manifestSchema = new mongoose.Schema({
  dataScopes: { type: [dataScopeSchema], default: [] },
  systems: { type: [String], default: [] },            // CC-brokered systems only
  egress: { type: [String], default: [] }              // allowed outbound hosts (none by default)
}, { _id: false });

const phaseEventSchema = new mongoose.Schema({
  phase: { type: String, enum: PHASES, required: true },
  detail: { type: String },
  at: { type: Date, default: Date.now }
}, { _id: false });

const appKitBuildSchema = new mongoose.Schema({
  // Stable public identifier used in the API and in callbacks.
  buildId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Command Center linkage (opaque CC identifiers; the project stays in CC).
  projectId: { type: String, required: true, index: true },
  requestId: { type: String, required: true, index: true }, // ties to ZDRAuditLedger.requestId

  // Multi-tenant identifiers (REQUIRED) — consistent with other flora-devops models.
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  // Authoritative-data owner (monolith Company / StudioCompany).
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudioCompany',
    index: true
  },

  // What is being built.
  appName: { type: String, required: true, trim: true },
  prompt: { type: String, required: true },
  manifest: { type: manifestSchema, default: () => ({}) },

  // Where CC wants phase transitions delivered.
  callbackUrl: { type: String },

  // Lifecycle state.
  phase: { type: String, enum: PHASES, default: 'accepted', index: true },
  phaseHistory: { type: [phaseEventSchema], default: [] },

  // Delivery outputs.
  templateVersion: { type: String },
  deployTarget: { type: String, enum: ['railway', 'vercel'], default: 'railway' },
  repo: { type: String },        // e.g. "enekwe/capital-call-tracker"
  deployUrl: { type: String },

  // Reference to the scoped app token CC minted for this build at `deploying`
  // (jti only — the raw token is never persisted here; it's injected into the
  // deployed app's environment). Used to trace/revoke via CC's token registry.
  appTokenJti: { type: String },

  // Drift analysis (populated from `tracking` onward).
  driftScore: { type: Number, min: 0, max: 100 },
  driftStatus: { type: String },

  // Failure detail (for `blocked` / `failed`).
  error: { type: String }
}, {
  timestamps: true,
  collection: 'appkit_builds'
});

appKitBuildSchema.index({ organizationId: 1, createdAt: -1 });
appKitBuildSchema.index({ projectId: 1, createdAt: -1 });

/**
 * Advance the build to a new phase, appending to the immutable phase history.
 * Does not persist — caller saves (so multiple mutations can batch).
 */
appKitBuildSchema.methods.setPhase = function (phase, detail) {
  if (!PHASES.includes(phase)) {
    throw new Error(`Unknown App Kit build phase: ${phase}`);
  }
  this.phase = phase;
  this.phaseHistory.push({ phase, detail, at: new Date() });
  return this;
};

appKitBuildSchema.statics.PHASES = PHASES;

module.exports = mongoose.model('AppKitBuild', appKitBuildSchema);
