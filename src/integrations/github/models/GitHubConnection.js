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

  // Backward compatibility with monolith (companyId)
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudioCompany',
    index: true
  },

  installedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // GitHub Installation ID (for GitHub App installations)
  installationId: {
    type: String,
    index: true,
    sparse: true
  },

  // GitHub account information
  accountType: {
    type: String,
    enum: ['User', 'Organization', 'Personal'],
    default: 'Personal'
  },

  accountLogin: {
    type: String,
    lowercase: true,
    index: true
  },

  accountId: {
    type: Number
  },

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
  tokenExpiry: {
    type: Date
  },

  // Repository Selection (for GitHub App)
  repositorySelection: {
    type: String,
    enum: ['all', 'selected'],
    default: 'selected'
  },

  // Connection metadata
  status: {
    type: String,
    enum: ['active', 'expired', 'revoked', 'error', 'suspended', 'uninstalled'],
    default: 'active'
  },
  lastSyncedAt: {
    type: Date
  },
  lastSyncAt: {
    type: Date
  },

  // Repositories accessible by installation
  accessibleRepositories: [{
    id: { type: Number, required: true },
    name: { type: String, required: true },
    fullName: { type: String, required: true },
    private: Boolean,
    defaultBranch: String,
    htmlUrl: String,
    language: String,
    size: Number,
    updatedAt: Date
  }],

  // Repositories actively monitored (subset of accessible)
  monitoredRepositories: [{
    type: Number
  }],

  repositories: [{
    id: Number,
    name: String,
    fullName: String,
    private: Boolean,
    webhookId: Number,
    webhookActive: Boolean
  }],

  // Webhook Configuration
  webhookId: {
    type: Number,
    index: true
  },

  webhookSecret: {
    type: String,
    select: false
  },

  webhookEvents: [{
    type: String,
    enum: [
      'push',
      'pull_request',
      'deployment',
      'deployment_status',
      'release',
      'repository',
      'issues',
      'issue_comment'
    ]
  }],

  // Installation Lifecycle
  installedAt: {
    type: Date
  },

  suspendedAt: {
    type: Date
  },

  uninstalledAt: {
    type: Date
  },

  // Health and Metrics
  health: {
    lastCheck: {
      type: Date,
      index: true
    },
    consecutiveFailures: {
      type: Number,
      default: 0
    },
    errorMessage: String
  },

  metrics: {
    totalWebhooks: {
      type: Number,
      default: 0
    },
    lastWebhookAt: Date,
    totalReposIndexed: {
      type: Number,
      default: 0
    }
  },

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
  { unique: true, sparse: true }
);

// Compound index for querying by user and organization
gitHubConnectionSchema.index({ userId: 1, organizationId: 1 });

// Compound index for active installations by company (backward compat)
gitHubConnectionSchema.index({ companyId: 1, status: 1 });

// Index for GitHub installation ID lookup (unique for App installations)
gitHubConnectionSchema.index({ installationId: 1 }, { unique: true, sparse: true });

// Index for health checks
gitHubConnectionSchema.index({ 'health.lastCheck': 1 });

// Update the updatedAt timestamp before saving
gitHubConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Post-save: Ensure token is not returned in response
gitHubConnectionSchema.post('save', function(doc) {
  delete doc.accessToken;
  delete doc.webhookSecret;
});

// Instance method to check if token is expired
gitHubConnectionSchema.methods.isTokenExpired = function() {
  // Check both expiresAt (new) and tokenExpiry (monolith compat)
  const expiry = this.expiresAt || this.tokenExpiry;
  if (!expiry) return false;
  return new Date() > expiry;
};

// Instance method to add repository (backward compat)
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

// Instance method to update repository webhook (backward compat)
gitHubConnectionSchema.methods.updateRepositoryWebhook = function(repoId, webhookId, webhookActive) {
  const repo = this.repositories.find(r => r.id === repoId);
  if (repo) {
    repo.webhookId = webhookId;
    repo.webhookActive = webhookActive;
  }
};

// Instance method to add monitored repository
gitHubConnectionSchema.methods.addMonitoredRepository = async function(repoId) {
  if (typeof repoId !== 'number') {
    throw new Error('Repository ID must be a number');
  }

  if (!this.monitoredRepositories) {
    this.monitoredRepositories = [];
  }

  if (!this.monitoredRepositories.includes(repoId)) {
    this.monitoredRepositories.push(repoId);
  }

  return await this.save();
};

// Instance method to remove monitored repository
gitHubConnectionSchema.methods.removeMonitoredRepository = async function(repoId) {
  if (typeof repoId !== 'number') {
    throw new Error('Repository ID must be a number');
  }

  if (this.monitoredRepositories) {
    this.monitoredRepositories = this.monitoredRepositories.filter(
      id => id !== repoId
    );
  }

  return await this.save();
};

// Instance method to set access token (with encryption)
gitHubConnectionSchema.methods.setAccessToken = async function(token) {
  if (!token) {
    throw new Error('Token cannot be empty');
  }
  this.accessToken = token;
  this._tokenAlreadyEncrypted = false;
  return await this.save();
};

// Instance method to get access token (with decryption - handled by service layer)
gitHubConnectionSchema.methods.getAccessToken = function() {
  if (!this.accessToken) {
    throw new Error('No access token stored');
  }
  // Decryption should be handled by the encryption utility in the service layer
  return this.accessToken;
};

const GitHubConnection = mongoose.model('GitHubConnection', gitHubConnectionSchema);

module.exports = GitHubConnection;
