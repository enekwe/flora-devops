const axios = require('axios');
const config = require('../../../config');
const encryption = require('../../../utils/encryption');
const LinearConnection = require('../models/LinearConnection');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class LinearService {
  constructor() {
    this.clientId = config.LINEAR_CLIENT_ID;
    this.clientSecret = config.LINEAR_CLIENT_SECRET;
    this.callbackUrl = config.LINEAR_CALLBACK_URL;
    this.apiUrl = 'https://api.linear.app/graphql';
    this.authUrl = 'https://linear.app/oauth';
  }

  // === AUTHENTICATION ===

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl({ userId, organizationId, state }) {
    const scope = 'read,write';

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope,
      state: JSON.stringify({ userId, organizationId, token: state })
    });

    return `${this.authUrl}/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(
        `${this.authUrl}/token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: this.callbackUrl,
          grant_type: 'authorization_code'
        }
      );

      return {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type,
        scope: response.data.scope,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      logger.error('Linear token exchange failed:', error);
      throw new AppError(
        error.response?.data?.error_description || 'Failed to exchange code for token',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get GraphQL client
   */
  getClient(accessToken) {
    return axios.create({
      baseURL: this.apiUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Execute GraphQL query
   */
  async executeQuery(accessToken, query, variables = {}) {
    try {
      const client = this.getClient(accessToken);
      const response = await client.post('', { query, variables });

      if (response.data.errors) {
        throw new Error(response.data.errors[0].message);
      }

      return response.data.data;
    } catch (error) {
      logger.error('Linear GraphQL query failed:', error);
      throw new AppError(
        error.response?.data?.errors?.[0]?.message || error.message || 'GraphQL query failed',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get Linear user information
   */
  async getUserInfo(accessToken) {
    const query = `
      query {
        viewer {
          id
          name
          email
          avatarUrl
          organization {
            id
            name
          }
        }
      }
    `;

    const data = await this.executeQuery(accessToken, query);

    return {
      linearUserId: data.viewer.id,
      linearUsername: data.viewer.name,
      linearEmail: data.viewer.email,
      linearAvatarUrl: data.viewer.avatarUrl,
      linearOrganizationId: data.viewer.organization?.id,
      linearOrganizationName: data.viewer.organization?.name
    };
  }

  /**
   * Connect Linear account
   */
  async connectAccount({ code, userId, organizationId }) {
    try {
      // Exchange code for token
      const tokenData = await this.exchangeCodeForToken(code);

      // Get user info
      const userInfo = await this.getUserInfo(tokenData.accessToken);

      // Encrypt the access token
      const encryptedAccessToken = encryption.encrypt(tokenData.accessToken);

      // Check if connection already exists
      let connection = await LinearConnection.findOne({
        organizationId,
        linearUserId: userInfo.linearUserId
      });

      if (connection) {
        // Update existing connection
        connection.userId = userId;
        connection.linearUsername = userInfo.linearUsername;
        connection.linearEmail = userInfo.linearEmail;
        connection.linearAvatarUrl = userInfo.linearAvatarUrl;
        connection.linearOrganizationId = userInfo.linearOrganizationId;
        connection.linearOrganizationName = userInfo.linearOrganizationName;
        connection.accessToken = encryptedAccessToken;
        connection.tokenType = tokenData.tokenType;
        connection.scope = tokenData.scope;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();
      } else {
        // Create new connection
        connection = new LinearConnection({
          userId,
          organizationId,
          linearUserId: userInfo.linearUserId,
          linearUsername: userInfo.linearUsername,
          linearEmail: userInfo.linearEmail,
          linearAvatarUrl: userInfo.linearAvatarUrl,
          linearOrganizationId: userInfo.linearOrganizationId,
          linearOrganizationName: userInfo.linearOrganizationName,
          accessToken: encryptedAccessToken,
          tokenType: tokenData.tokenType,
          scope: tokenData.scope,
          status: 'active',
          lastSyncedAt: new Date()
        });
      }

      await connection.save();

      logger.info(`Linear account connected for user ${userId} in organization ${organizationId}`);

      return {
        id: connection._id,
        linearUsername: connection.linearUsername,
        linearEmail: connection.linearEmail,
        linearAvatarUrl: connection.linearAvatarUrl,
        linearOrganizationName: connection.linearOrganizationName,
        status: connection.status,
        createdAt: connection.createdAt
      };
    } catch (error) {
      logger.error('Linear account connection failed:', error);
      throw error;
    }
  }

  /**
   * Disconnect Linear account
   */
  async disconnectAccount(userId, organizationId) {
    try {
      const connection = await LinearConnection.findOneAndDelete({
        userId,
        organizationId
      });

      if (!connection) {
        throw new AppError('Linear connection not found', 404);
      }

      logger.info(`Linear account disconnected for user ${userId} in organization ${organizationId}`);

      return { message: 'Linear account disconnected successfully' };
    } catch (error) {
      logger.error('Linear account disconnection failed:', error);
      throw error;
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(userId, organizationId) {
    const connection = await LinearConnection.findOne({
      userId,
      organizationId
    });

    if (!connection) {
      return { connected: false };
    }

    return {
      connected: true,
      linearUsername: connection.linearUsername,
      linearEmail: connection.linearEmail,
      linearAvatarUrl: connection.linearAvatarUrl,
      linearOrganizationName: connection.linearOrganizationName,
      status: connection.status,
      lastSyncedAt: connection.lastSyncedAt,
      teamCount: connection.teams.length
    };
  }

  /**
   * Get decrypted access token
   */
  async getAccessToken(userId, organizationId) {
    const connection = await LinearConnection.findOne({
      userId,
      organizationId
    }).select('+accessToken');

    if (!connection) {
      throw new AppError('Linear connection not found', 404);
    }

    if (connection.status !== 'active') {
      throw new AppError('Linear connection is not active', 403);
    }

    return encryption.decrypt(connection.accessToken);
  }

  // === TEAMS ===

  /**
   * List teams
   */
  async listTeams(userId, organizationId) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId);

      const query = `
        query {
          teams {
            nodes {
              id
              name
              key
              description
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query);

      // Update connection with teams
      const connection = await LinearConnection.findOne({ userId, organizationId });
      if (connection) {
        data.teams.nodes.forEach(team => connection.addTeam(team));
        await connection.save();
      }

      return data.teams.nodes.map(team => ({
        id: team.id,
        name: team.name,
        key: team.key,
        description: team.description
      }));
    } catch (error) {
      logger.error('Failed to list Linear teams:', error);
      throw error;
    }
  }

  // === ISSUES ===

  /**
   * List issues
   */
  async listIssues(userId, organizationId, options = {}) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId);

      const filter = {};
      if (options.teamId) filter.team = { id: { eq: options.teamId } };
      if (options.assigneeId) filter.assignee = { id: { eq: options.assigneeId } };
      if (options.state) filter.state = { name: { eq: options.state } };

      const query = `
        query($filter: IssueFilter) {
          issues(filter: $filter, first: 50) {
            nodes {
              id
              identifier
              title
              description
              priority
              state {
                id
                name
                type
              }
              assignee {
                id
                name
                email
              }
              team {
                id
                name
                key
              }
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
              createdAt
              updatedAt
              url
            }
          }
        }
      `;

      const data = await this.executeQuery(accessToken, query, { filter });

      return data.issues.nodes.map(issue => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        state: {
          id: issue.state.id,
          name: issue.state.name,
          type: issue.state.type
        },
        assignee: issue.assignee ? {
          id: issue.assignee.id,
          name: issue.assignee.name,
          email: issue.assignee.email
        } : null,
        team: {
          id: issue.team.id,
          name: issue.team.name,
          key: issue.team.key
        },
        labels: issue.labels.nodes.map(label => ({
          id: label.id,
          name: label.name,
          color: label.color
        })),
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        url: issue.url
      }));
    } catch (error) {
      logger.error('Failed to list Linear issues:', error);
      throw error;
    }
  }

  /**
   * Create an issue
   */
  async createIssue(userId, organizationId, issueData) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId);

      const query = `
        mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              description
              priority
              state {
                id
                name
              }
              url
              createdAt
            }
          }
        }
      `;

      const input = {
        teamId: issueData.teamId,
        title: issueData.title,
        description: issueData.description || ''
      };

      if (issueData.assigneeId) input.assigneeId = issueData.assigneeId;
      if (issueData.priority !== undefined) input.priority = issueData.priority;
      if (issueData.labelIds) input.labelIds = issueData.labelIds;

      const data = await this.executeQuery(accessToken, query, { input });

      if (!data.issueCreate.success) {
        throw new AppError('Failed to create Linear issue', 500);
      }

      const issue = data.issueCreate.issue;

      logger.info(`Linear issue created: ${issue.identifier}`);

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        state: issue.state,
        url: issue.url,
        createdAt: issue.createdAt
      };
    } catch (error) {
      logger.error('Failed to create Linear issue:', error);
      throw error;
    }
  }

  /**
   * Update an issue
   */
  async updateIssue(userId, organizationId, issueId, updates) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId);

      const query = `
        mutation($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue {
              id
              identifier
              title
              description
              priority
              state {
                id
                name
              }
              updatedAt
            }
          }
        }
      `;

      const input = {};
      if (updates.title) input.title = updates.title;
      if (updates.description !== undefined) input.description = updates.description;
      if (updates.priority !== undefined) input.priority = updates.priority;
      if (updates.assigneeId) input.assigneeId = updates.assigneeId;
      if (updates.stateId) input.stateId = updates.stateId;
      if (updates.labelIds) input.labelIds = updates.labelIds;

      const data = await this.executeQuery(accessToken, query, { id: issueId, input });

      if (!data.issueUpdate.success) {
        throw new AppError('Failed to update Linear issue', 500);
      }

      logger.info(`Linear issue updated: ${data.issueUpdate.issue.identifier}`);

      return data.issueUpdate.issue;
    } catch (error) {
      logger.error('Failed to update Linear issue:', error);
      throw error;
    }
  }

  // === WEBHOOKS ===

  /**
   * Create a webhook
   */
  async createWebhook(userId, organizationId, webhookData) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId);

      const query = `
        mutation($input: WebhookCreateInput!) {
          webhookCreate(input: $input) {
            success
            webhook {
              id
              enabled
              url
              resourceTypes
            }
          }
        }
      `;

      const input = {
        url: webhookData.url,
        resourceTypes: webhookData.events || ['Issue', 'Comment'],
        enabled: webhookData.active !== undefined ? webhookData.active : true
      };

      if (webhookData.teamId) input.teamId = webhookData.teamId;
      if (webhookData.secret) input.secret = webhookData.secret;

      const data = await this.executeQuery(accessToken, query, { input });

      if (!data.webhookCreate.success) {
        throw new AppError('Failed to create Linear webhook', 500);
      }

      const webhook = data.webhookCreate.webhook;

      // Update connection with webhook info
      if (webhookData.teamId) {
        const connection = await LinearConnection.findOne({ userId, organizationId });
        if (connection) {
          connection.updateTeamWebhook(webhookData.teamId, webhook.id, webhook.enabled);
          await connection.save();
        }
      }

      logger.info(`Linear webhook created: ${webhook.id}`);

      return {
        id: webhook.id,
        enabled: webhook.enabled,
        url: webhook.url,
        resourceTypes: webhook.resourceTypes
      };
    } catch (error) {
      logger.error('Failed to create Linear webhook:', error);
      throw error;
    }
  }
}

module.exports = new LinearService();
