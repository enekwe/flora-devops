const mongoose = require('mongoose');

const railwayConnectionSchema = new mongoose.Schema({
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

  // Railway account information
  railwayUserId: {
    type: String,
    required: true,
    index: true
  },
  username: {
    type: String,
    lowercase: true,
    index: true
  },
  email: {
    type: String,
    lowercase: true
  },
  name: {
    type: String
  },
  avatar: {
    type: String
  },

  // Team information (if connected to a team)
  teamId: {
    type: String,
    index: true,
    sparse: true
  },
  teamSlug: {
    type: String,
    lowercase: true,
    index: true,
    sparse: true
  },
  teamName: {
    type: String
  },

  // OAuth tokens (encrypted, not selected by default)
  // Note: Railway tokens have refresh tokens and can expire
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
  tokenExpiresAt: {
    type: Date,
    select: false
  },

  // Connection metadata
  status: {
    type: String,
    enum: ['active', 'expired', 'disconnected', 'error'],
    default: 'active'
  },
  lastSyncedAt: {
    type: Date
  },

  // Projects tracked by this connection
  projects: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: String,
    createdAt: Date,
    updatedAt: Date,
    // Services within project
    services: [{
      id: { type: String, required: true },
      name: { type: String, required: true },
      icon: String,
      createdAt: Date,
      updatedAt: Date
    }],
    // Latest deployment
    latestDeployment: {
      id: String,
      status: String,
      createdAt: Date
    }
  }],

  // Monitored projects (subset of all projects)
  monitoredProjects: [{
    type: String
  }],

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
    totalProjects: {
      type: Number,
      default: 0
    },
    totalDeployments: {
      type: Number,
      default: 0
    },
    lastDeploymentAt: Date
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

// Unique constraint: one Railway account per organization
railwayConnectionSchema.index(
  { organizationId: 1, railwayUserId: 1 },
  { unique: true, sparse: true }
);

// Compound index for querying by user and organization
railwayConnectionSchema.index({ userId: 1, organizationId: 1 });

// Compound index for active connections by company (backward compat)
railwayConnectionSchema.index({ companyId: 1, status: 1 });

// Index for team lookup
railwayConnectionSchema.index({ teamId: 1 }, { sparse: true });

// Index for health checks
railwayConnectionSchema.index({ 'health.lastCheck': 1 });

// Update the updatedAt timestamp before saving
railwayConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Post-save: Ensure tokens are not returned in response
railwayConnectionSchema.post('save', function(doc) {
  delete doc.accessToken;
  delete doc.refreshToken;
  delete doc.tokenExpiresAt;
});

// Instance method to add project
railwayConnectionSchema.methods.addProject = function(project) {
  const exists = this.projects.some(p => p.id === project.id);
  if (!exists) {
    this.projects.push({
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      services: project.services || [],
      latestDeployment: project.latestDeployment || {}
    });
  }
};

// Instance method to update project
railwayConnectionSchema.methods.updateProject = function(projectId, updates) {
  const project = this.projects.find(p => p.id === projectId);
  if (project) {
    Object.assign(project, updates);
  }
};

// Instance method to add monitored project
railwayConnectionSchema.methods.addMonitoredProject = async function(projectId) {
  if (typeof projectId !== 'string') {
    throw new Error('Project ID must be a string');
  }

  if (!this.monitoredProjects) {
    this.monitoredProjects = [];
  }

  if (!this.monitoredProjects.includes(projectId)) {
    this.monitoredProjects.push(projectId);
  }

  return await this.save();
};

// Instance method to remove monitored project
railwayConnectionSchema.methods.removeMonitoredProject = async function(projectId) {
  if (typeof projectId !== 'string') {
    throw new Error('Project ID must be a string');
  }

  if (this.monitoredProjects) {
    this.monitoredProjects = this.monitoredProjects.filter(
      id => id !== projectId
    );
  }

  return await this.save();
};

// Instance method to set access token (with encryption)
railwayConnectionSchema.methods.setAccessToken = async function(token) {
  if (!token) {
    throw new Error('Token cannot be empty');
  }
  this.accessToken = token;
  this._tokenAlreadyEncrypted = false;
  return await this.save();
};

// Instance method to get access token (with decryption - handled by service layer)
railwayConnectionSchema.methods.getAccessToken = function() {
  if (!this.accessToken) {
    throw new Error('No access token stored');
  }
  // Decryption should be handled by the encryption utility in the service layer
  return this.accessToken;
};

const RailwayConnection = mongoose.model('RailwayConnection', railwayConnectionSchema);

module.exports = RailwayConnection;
