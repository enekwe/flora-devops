const mongoose = require('mongoose');

const gitLabConnectionSchema = new mongoose.Schema({
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

  // GitLab account information
  gitlabUserId: {
    type: String,
    required: true
  },
  gitlabUsername: {
    type: String,
    required: true
  },
  gitlabEmail: {
    type: String
  },
  gitlabAvatarUrl: {
    type: String
  },
  gitlabInstanceUrl: {
    type: String,
    default: 'https://gitlab.com'
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
  projects: [{
    id: Number,
    name: String,
    pathWithNamespace: String,
    visibility: String,
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

// Unique constraint: one GitLab account per organization
gitLabConnectionSchema.index(
  { organizationId: 1, gitlabUserId: 1 },
  { unique: true }
);

// Compound index for querying by user and organization
gitLabConnectionSchema.index({ userId: 1, organizationId: 1 });

// Update the updatedAt timestamp before saving
gitLabConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Instance method to check if token is expired
gitLabConnectionSchema.methods.isTokenExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Instance method to add project
gitLabConnectionSchema.methods.addProject = function(project) {
  const exists = this.projects.some(p => p.id === project.id);
  if (!exists) {
    this.projects.push({
      id: project.id,
      name: project.name,
      pathWithNamespace: project.path_with_namespace,
      visibility: project.visibility,
      webhookId: null,
      webhookActive: false
    });
  }
};

// Instance method to update project webhook
gitLabConnectionSchema.methods.updateProjectWebhook = function(projectId, webhookId, webhookActive) {
  const project = this.projects.find(p => p.id === projectId);
  if (project) {
    project.webhookId = webhookId;
    project.webhookActive = webhookActive;
  }
};

const GitLabConnection = mongoose.model('GitLabConnection', gitLabConnectionSchema);

module.exports = GitLabConnection;
