# Railway Integration for Flora DevOps

Complete Railway.app integration with OAuth authentication, project management, deployment tracking, and GraphQL API support.

## Overview

This integration enables Flora DevOps to connect with Railway accounts and manage:
- Projects and services
- Deployments and logs
- Environment variables
- Teams and permissions

## Architecture

The integration follows a clean, layered architecture:

```
railway/
├── models/
│   └── RailwayConnection.js       # Multi-tenant MongoDB schema
├── services/
│   ├── railwayAuthService.js      # OAuth flow & token management
│   ├── railwayApiService.js       # GraphQL API client
│   └── railwayService.js          # Business logic layer
└── routes/
    └── index.js                    # REST API endpoints
```

## Key Features

### 1. OAuth Authentication
- Full OAuth 2.0 authorization code flow
- Automatic token refresh handling
- Secure token encryption at rest
- Coming soon mode when credentials not configured

### 2. GraphQL API Client
- Railway uses GraphQL (unlike Vercel's REST API)
- Type-safe query execution
- Comprehensive error handling
- Support for all Railway resources

### 3. Multi-Tenant Architecture
- Per-organization connections
- Team support
- Backward compatibility with monolith companyId
- Health monitoring and metrics

### 4. Token Management
- Access tokens with expiration
- Refresh tokens for token renewal
- Automatic token refresh on expiration
- Encrypted storage with AES-256

## API Endpoints

### Authentication
- `GET /api/integrations/railway/auth` - Generate OAuth URL
- `GET /api/integrations/railway/callback` - OAuth callback handler
- `POST /api/integrations/railway/disconnect` - Disconnect account
- `GET /api/integrations/railway/status` - Get connection status

### Projects
- `GET /api/integrations/railway/projects` - List all projects
- `GET /api/integrations/railway/projects/:projectId` - Get project details
- `POST /api/integrations/railway/projects` - Create new project

### Services
- `GET /api/integrations/railway/projects/:projectId/services` - List services
- `GET /api/integrations/railway/services/:serviceId` - Get service details
- `POST /api/integrations/railway/projects/:projectId/services` - Create service

### Deployments
- `GET /api/integrations/railway/services/:serviceId/deployments` - List deployments
- `GET /api/integrations/railway/deployments/:deploymentId` - Get deployment details
- `POST /api/integrations/railway/services/:serviceId/deployments` - Trigger deployment
- `GET /api/integrations/railway/deployments/:deploymentId/logs` - Get deployment logs

### Environment Variables
- `GET /api/integrations/railway/services/:serviceId/env` - Get environment variables
- `POST /api/integrations/railway/services/:serviceId/env` - Set environment variables

## Configuration

### Environment Variables

Add to `.env`:

```bash
# Railway OAuth
RAILWAY_CLIENT_ID=your-railway-client-id
RAILWAY_CLIENT_SECRET=your-railway-client-secret
RAILWAY_CALLBACK_URL=http://localhost:4003/api/integrations/railway/callback
```

### Getting OAuth Credentials

1. Go to https://railway.app/account/oauth-apps
2. Create a new OAuth application
3. Set callback URL to match your environment
4. Copy Client ID and Client Secret to `.env`

### Coming Soon Mode

If `RAILWAY_CLIENT_ID` and `RAILWAY_CLIENT_SECRET` are not set, the integration will return:

```json
{
  "success": false,
  "available": false,
  "status": "coming_soon",
  "message": "Railway integration coming soon. OAuth credentials not yet configured."
}
```

## Database Schema

### RailwayConnection Model

```javascript
{
  // Multi-tenant identifiers
  userId: ObjectId,              // User who connected
  organizationId: ObjectId,      // Organization owner
  companyId: ObjectId,           // Backward compatibility

  // Railway account info
  railwayUserId: String,         // Railway user ID
  username: String,              // Railway username
  email: String,                 // Railway email
  name: String,                  // Display name
  avatar: String,                // Avatar URL

  // Team info (optional)
  teamId: String,                // Railway team ID
  teamSlug: String,              // Team slug
  teamName: String,              // Team name

  // OAuth tokens (encrypted)
  accessToken: String,           // Encrypted access token
  refreshToken: String,          // Encrypted refresh token
  tokenType: String,             // "Bearer"
  tokenExpiresAt: Date,          // Token expiration

  // Connection status
  status: String,                // active, expired, disconnected, error
  lastSyncedAt: Date,            // Last sync timestamp

  // Projects cache
  projects: [{
    id: String,
    name: String,
    description: String,
    services: Array,
    latestDeployment: Object
  }],

  // Monitored projects
  monitoredProjects: [String],   // Project IDs to monitor

  // Health and metrics
  health: {
    lastCheck: Date,
    consecutiveFailures: Number,
    errorMessage: String
  },
  metrics: {
    totalProjects: Number,
    totalDeployments: Number,
    lastDeploymentAt: Date
  }
}
```

## Railway API Differences

### vs Vercel Integration

| Feature | Vercel | Railway |
|---------|--------|---------|
| API Type | REST | GraphQL |
| Token Expiration | No | Yes |
| Refresh Tokens | No | Yes |
| Resource Hierarchy | Projects | Projects → Services |
| Environment Variables | Per-project | Per-service |

### GraphQL Queries

Railway uses GraphQL for all API operations:

```graphql
# List projects
query {
  projects {
    edges {
      node {
        id
        name
        services {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  }
}
```

## Usage Examples

### Connect Railway Account

```javascript
// 1. Generate OAuth URL
GET /api/integrations/railway/auth?userId=123&organizationId=456

Response:
{
  "success": true,
  "authUrl": "https://railway.app/oauth?client_id=...",
  "state": "csrf-token"
}

// 2. User authorizes on Railway
// 3. Railway redirects to callback

GET /api/integrations/railway/callback?code=xyz&state={...}

Response:
{
  "success": true,
  "message": "Railway account connected successfully",
  "data": {
    "id": "connection-id",
    "railwayUserId": "user-id",
    "username": "john",
    "email": "john@example.com"
  }
}
```

### List Projects

```javascript
GET /api/integrations/railway/projects?userId=123&organizationId=456

Response:
{
  "success": true,
  "data": [
    {
      "id": "project-1",
      "name": "My App",
      "description": "Production app",
      "services": [
        {
          "id": "service-1",
          "name": "web",
          "icon": "nodejs"
        }
      ],
      "latestDeployment": {
        "id": "deploy-1",
        "status": "SUCCESS",
        "createdAt": "2024-07-07T00:00:00Z"
      }
    }
  ]
}
```

### Trigger Deployment

```javascript
POST /api/integrations/railway/services/service-123/deployments?userId=123&organizationId=456

Response:
{
  "success": true,
  "message": "Deployment triggered successfully",
  "data": {
    "id": "deploy-456",
    "status": "BUILDING",
    "createdAt": "2024-07-07T00:00:00Z"
  }
}
```

### Set Environment Variables

```javascript
POST /api/integrations/railway/services/service-123/env?userId=123&organizationId=456
Content-Type: application/json

{
  "NODE_ENV": "production",
  "API_KEY": "secret-key",
  "DATABASE_URL": "postgres://..."
}

Response:
{
  "success": true,
  "message": "Environment variables updated successfully"
}
```

## Security

### Token Encryption

All OAuth tokens are encrypted using AES-256-CBC before storage:

```javascript
const encryption = require('../../../utils/encryption');

// Encrypt before saving
connection.accessToken = encryption.encrypt(tokenData.accessToken);

// Decrypt when needed
const accessToken = encryption.decrypt(connection.accessToken);
```

### Token Refresh

Tokens are automatically refreshed when expired:

```javascript
if (connection.tokenExpiresAt < new Date()) {
  const tokenData = await railwayAuthService.refreshAccessToken(refreshToken);
  // Update connection with new tokens
}
```

### Coming Soon Mode

Returns 503 status when OAuth credentials not configured:

```javascript
if (!railwayAuthService.isAvailable()) {
  return res.status(503).json({
    available: false,
    status: 'coming_soon',
    message: 'Railway integration coming soon'
  });
}
```

## Error Handling

### GraphQL Errors

Railway returns errors in GraphQL format:

```json
{
  "errors": [
    {
      "message": "Project not found",
      "extensions": {
        "code": "NOT_FOUND"
      }
    }
  ]
}
```

Handled by `railwayApiService.handleError()`:

```javascript
if (response.data.errors) {
  throw new AppError(
    `Railway GraphQL error: ${response.data.errors[0].message}`,
    400
  );
}
```

### Connection Status

Status tracking with health checks:

```javascript
{
  status: 'active',      // active, expired, disconnected, error
  health: {
    lastCheck: Date,
    consecutiveFailures: 0,
    errorMessage: null
  }
}
```

## Testing

### Unit Tests

Test each service independently:

```bash
npm test src/integrations/railway/services/railwayAuthService.test.js
npm test src/integrations/railway/services/railwayApiService.test.js
npm test src/integrations/railway/services/railwayService.test.js
```

### Integration Tests

Test full OAuth flow:

```bash
npm test src/integrations/railway/integration.test.js
```

### Manual Testing

1. Set up OAuth credentials in `.env`
2. Start the service: `npm run dev`
3. Test OAuth flow: `GET /api/integrations/railway/auth`
4. Complete authorization on Railway
5. Verify callback: Check logs for successful connection

## Monitoring

### Health Checks

The integration tracks connection health:

```javascript
await railwayService.updateHealthCheck(connectionId, success, errorMessage);
```

- Updates `health.lastCheck` timestamp
- Tracks consecutive failures
- Auto-marks as error after 3 failures

### Metrics

Connection metrics are tracked:

```javascript
{
  metrics: {
    totalProjects: 10,
    totalDeployments: 150,
    lastDeploymentAt: Date
  }
}
```

## Future Enhancements

- [ ] Webhook support for deployment events
- [ ] Real-time deployment logs (WebSocket)
- [ ] Cost tracking and billing integration
- [ ] Team member management
- [ ] Resource usage metrics
- [ ] Automated deployment rollbacks
- [ ] Custom deployment triggers
- [ ] Integration with CI/CD pipelines

## Support

For Railway API documentation:
- GraphQL API: https://docs.railway.app/reference/public-api
- OAuth: https://docs.railway.app/reference/public-api#authentication

For Flora DevOps issues:
- GitHub: https://github.com/enekwe/flora-devops/issues
- Documentation: https://docs.flora.app/devops/railway

## License

MIT License - See LICENSE file for details
