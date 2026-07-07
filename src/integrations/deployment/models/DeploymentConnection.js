const mongoose = require('mongoose');

// Generic deployment platform connection schema
const deploymentConnectionSchema = new mongoose.Schema({
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

  // Platform information
  platform: {
    type: String,
    enum: ['vercel', 'netlify'],
    required: true
  },
  platformUserId: {
    type: String,
    required: true
  },
  platformUsername: {
    type: String
  },
  platformEmail: {
    type: String
  },
  platformTeamId: {
    type: String
  },
  platformTeamName: {
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
  projects: [{
    id: String,
    name: String,
    url: String,
    framework: String,
    production: {
      domain: String,
      status: String,
      url: String
    }
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

// Unique constraint: one platform account per organization
deploymentConnectionSchema.index(
  { organizationId: 1, platform: 1, platformUserId: 1 },
  { unique: true }
);

// Compound index for querying by user and organization
deploymentConnectionSchema.index({ userId: 1, organizationId: 1, platform: 1 });

// Update the updatedAt timestamp before saving
deploymentConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Instance method to check if token is expired
deploymentConnectionSchema.methods.isTokenExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Instance method to add project
deploymentConnectionSchema.methods.addProject = function(project) {
  const exists = this.projects.some(p => p.id === project.id);
  if (!exists) {
    this.projects.push({
      id: project.id,
      name: project.name,
      url: project.url || project.alias?.[0] || null,
      framework: project.framework,
      production: project.production || {}
    });
  }
};

// Instance method to update project
deploymentConnectionSchema.methods.updateProject = function(projectId, updates) {
  const project = this.projects.find(p => p.id === projectId);
  if (project) {
    Object.assign(project, updates);
  }
};

const DeploymentConnection = mongoose.model('DeploymentConnection', deploymentConnectionSchema);

module.exports = DeploymentConnection;
