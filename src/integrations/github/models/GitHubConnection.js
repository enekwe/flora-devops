const mongoose = require('mongoose');

const gitHubConnectionSchema = new mongoose.Schema({
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

  // GitHub account information
  githubUserId: {
    type: String,
    required: true
  },
  githubUsername: {
    type: String,
    required: true
  },
  githubEmail: {
    type: String
  },
  githubAvatarUrl: {
    type: String
  },

  // OAuth tokens (encrypted, not selected by default)
  accessToken: {
    type: String,
    required: true,
    select: false
  },
  refreshToken: {
    type: String,
    select: false
  },
  tokenType: {
    type: String,
    default: 'Bearer'
  },
  scope: {
    type: String
  },
  expiresAt: {
    type: Date
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
  repositories: [{
    id: Number,
    name: String,
    fullName: String,
    private: Boolean,
    webhookId: Number,
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

// Unique constraint: one GitHub account per organization
gitHubConnectionSchema.index(
  { organizationId: 1, githubUserId: 1 },
  { unique: true }
);

// Compound index for querying by user and organization
gitHubConnectionSchema.index({ userId: 1, organizationId: 1 });

// Update the updatedAt timestamp before saving
gitHubConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Instance method to check if token is expired
gitHubConnectionSchema.methods.isTokenExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Instance method to add repository
gitHubConnectionSchema.methods.addRepository = function(repo) {
  const exists = this.repositories.some(r => r.id === repo.id);
  if (!exists) {
    this.repositories.push({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      webhookId: null,
      webhookActive: false
    });
  }
};

// Instance method to update repository webhook
gitHubConnectionSchema.methods.updateRepositoryWebhook = function(repoId, webhookId, webhookActive) {
  const repo = this.repositories.find(r => r.id === repoId);
  if (repo) {
    repo.webhookId = webhookId;
    repo.webhookActive = webhookActive;
  }
};

const GitHubConnection = mongoose.model('GitHubConnection', gitHubConnectionSchema);

module.exports = GitHubConnection;
