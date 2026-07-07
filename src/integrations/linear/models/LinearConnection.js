const mongoose = require('mongoose');

const linearConnectionSchema = new mongoose.Schema({
  // Multi-tenant identifiers (REQUIRED)
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

  // Linear account information
  linearUserId: {
    type: String,
    required: true
  },
  linearUsername: {
    type: String,
    required: true
  },
  linearEmail: {
    type: String
  },
  linearAvatarUrl: {
    type: String
  },
  linearOrganizationId: {
    type: String
  },
  linearOrganizationName: {
    type: String
  },

  // OAuth tokens (encrypted, not selected by default)
  accessToken: {
    type: String,
    required: true,
    select: false
  },
  tokenType: {
    type: String,
    default: 'Bearer'
  },
  scope: {
    type: String
  },

  // Connection metadata
  status: {
    type: String,
    enum: ['active', 'expired', 'revoked', 'error'],
    default: 'active'
  },
  lastSyncedAt: {
    type: Date
  },
  teams: [{
    id: String,
    name: String,
    key: String,
    webhookId: String,
    webhookActive: Boolean
  }],

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Unique constraint: one Linear account per organization
linearConnectionSchema.index(
  { organizationId: 1, linearUserId: 1 },
  { unique: true }
);

// Compound index for querying by user and organization
linearConnectionSchema.index({ userId: 1, organizationId: 1 });

// Update the updatedAt timestamp before saving
linearConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Instance method to add team
linearConnectionSchema.methods.addTeam = function(team) {
  const exists = this.teams.some(t => t.id === team.id);
  if (!exists) {
    this.teams.push({
      id: team.id,
      name: team.name,
      key: team.key,
      webhookId: null,
      webhookActive: false
    });
  }
};

// Instance method to update team webhook
linearConnectionSchema.methods.updateTeamWebhook = function(teamId, webhookId, webhookActive) {
  const team = this.teams.find(t => t.id === teamId);
  if (team) {
    team.webhookId = webhookId;
    team.webhookActive = webhookActive;
  }
};

const LinearConnection = mongoose.model('LinearConnection', linearConnectionSchema);

module.exports = LinearConnection;
