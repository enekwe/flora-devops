const mongoose = require('mongoose');

const vercelConnectionSchema = new mongoose.Schema({
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

  // Vercel account information
  vercelUserId: {
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
  teamAvatar: {
    type: String
  },

  // OAuth tokens (encrypted, not selected by default)
  // Note: Vercel tokens do not expire and don't have refresh tokens
  accessToken: {
    type: String,
    required: true,
    select: false
  },
  tokenType: {
    type: String,
    default: 'Bearer'
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
    framework: String,
    devCommand: String,
    buildCommand: String,
    outputDirectory: String,
    nodeVersion: String,
    createdAt: Number,
    updatedAt: Number,
    latestDeployment: {
      uid: String,
      url: String,
      state: String,
      readyState: String,
      createdAt: Number
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

// Unique constraint: one Vercel account per organization
vercelConnectionSchema.index(
  { organizationId: 1, vercelUserId: 1 },
  { unique: true, sparse: true }
);

// Compound index for querying by user and organization
vercelConnectionSchema.index({ userId: 1, organizationId: 1 });

// Compound index for active connections by company (backward compat)
vercelConnectionSchema.index({ companyId: 1, status: 1 });

// Index for team lookup
vercelConnectionSchema.index({ teamId: 1 }, { sparse: true });

// Index for health checks
vercelConnectionSchema.index({ 'health.lastCheck': 1 });

// Update the updatedAt timestamp before saving
vercelConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Post-save: Ensure token is not returned in response
vercelConnectionSchema.post('save', function(doc) {
  delete doc.accessToken;
});

// Instance method to add project
vercelConnectionSchema.methods.addProject = function(project) {
  const exists = this.projects.some(p => p.id === project.id);
  if (!exists) {
    this.projects.push({
      id: project.id,
      name: project.name,
      framework: project.framework,
      devCommand: project.devCommand,
      buildCommand: project.buildCommand,
      outputDirectory: project.outputDirectory,
      nodeVersion: project.nodeVersion,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      latestDeployment: project.latestDeployment || {}
    });
  }
};

// Instance method to update project
vercelConnectionSchema.methods.updateProject = function(projectId, updates) {
  const project = this.projects.find(p => p.id === projectId);
  if (project) {
    Object.assign(project, updates);
  }
};

// Instance method to add monitored project
vercelConnectionSchema.methods.addMonitoredProject = async function(projectId) {
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
vercelConnectionSchema.methods.removeMonitoredProject = async function(projectId) {
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
vercelConnectionSchema.methods.setAccessToken = async function(token) {
  if (!token) {
    throw new Error('Token cannot be empty');
  }
  this.accessToken = token;
  this._tokenAlreadyEncrypted = false;
  return await this.save();
};

// Instance method to get access token (with decryption - handled by service layer)
vercelConnectionSchema.methods.getAccessToken = function() {
  if (!this.accessToken) {
    throw new Error('No access token stored');
  }
  // Decryption should be handled by the encryption utility in the service layer
  return this.accessToken;
};

const VercelConnection = mongoose.model('VercelConnection', vercelConnectionSchema);

module.exports = VercelConnection;
