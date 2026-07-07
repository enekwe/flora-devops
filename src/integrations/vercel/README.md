# Vercel Integration

Complete Vercel integration for flora-devops microservice with OAuth authentication, project management, deployment tracking, and environment variable management.

## Status

**Coming Soon** - Fully functional, awaiting OAuth credentials.

The integration is complete and ready to use. It will return "coming soon" responses until `VERCEL_CLIENT_ID` and `VERCEL_CLIENT_SECRET` are configured.

## Features

### Authentication
- OAuth 2.0 flow with Vercel
- Multi-tenant support (userId + organizationId)
- Encrypted token storage using AES-256-GCM
- Team and personal account support
- Automatic "coming soon" mode when credentials not configured

### Project Management
- List all projects
- Get project details
- Support for both personal and team projects
- Project metadata tracking (framework, build config, etc.)

### Deployment Operations
- List deployments by project
- Get deployment details
- View deployment logs
- Filter by state (BUILDING, READY, ERROR, etc.)
- Filter by target (production, preview, development)

### Domain Management
- List domains for projects
- Get domain details
- View domain verification status

### Environment Variables
- List environment variables
- Create new variables
- Update existing variables
- Delete variables
- Support for multiple targets (production, preview, development)

## Setup

### 1. Get Vercel OAuth Credentials

1. Go to [Vercel Integration Console](https://vercel.com/account/settings/integrations)
2. Click "Create Integration"
3. Fill in integration details:
   - **Name**: Flora DevOps
   - **Redirect URL**: `http://localhost:4003/api/integrations/vercel/callback` (for dev)
   - For production: `https://your-domain.com/api/integrations/vercel/callback`
4. Copy the Client ID and Client Secret

### 2. Configure Environment Variables

Update your `.env` file:

```env
# Vercel OAuth
VERCEL_CLIENT_ID=your-vercel-client-id
VERCEL_CLIENT_SECRET=your-vercel-client-secret
VERCEL_CALLBACK_URL=http://localhost:4003/api/integrations/vercel/callback
```

### 3. Restart the Service

```bash
npm run dev
```

The integration will automatically become available once credentials are set.

## API Endpoints

### Authentication

#### Generate OAuth URL
```http
GET /api/integrations/vercel/auth?userId=USER_ID&organizationId=ORG_ID
```

Response:
```json
{
  "success": true,
  "authUrl": "https://vercel.com/oauth/authorize?...",
  "state": "random-csrf-token"
}
```

#### OAuth Callback
```http
GET /api/integrations/vercel/callback?code=CODE&state=STATE
```

Response:
```json
{
  "success": true,
  "message": "Vercel account connected successfully",
  "data": {
    "id": "connection-id",
    "vercelUserId": "user-id",
    "username": "username",
    "email": "user@example.com",
    "status": "active"
  }
}
```

#### Disconnect Account
```http
POST /api/integrations/vercel/disconnect
Content-Type: application/json

{
  "userId": "USER_ID",
  "organizationId": "ORG_ID"
}
```

#### Get Connection Status
```http
GET /api/integrations/vercel/status?userId=USER_ID&organizationId=ORG_ID
```

Response (when not configured):
```json
{
  "success": true,
  "data": {
    "available": false,
    "status": "coming_soon",
    "message": "Vercel integration coming soon"
  }
}
```

Response (when connected):
```json
{
  "success": true,
  "data": {
    "available": true,
    "connected": true,
    "username": "username",
    "email": "user@example.com",
    "teamId": "team-id",
    "status": "active",
    "projectCount": 5
  }
}
```

### Projects

#### List Projects
```http
GET /api/integrations/vercel/projects?userId=USER_ID&organizationId=ORG_ID&limit=20&search=my-app
```

#### Get Project Details
```http
GET /api/integrations/vercel/projects/PROJECT_ID?userId=USER_ID&organizationId=ORG_ID
```

### Deployments

#### List Deployments
```http
GET /api/integrations/vercel/projects/PROJECT_ID/deployments?userId=USER_ID&organizationId=ORG_ID&limit=10&state=READY
```

Query parameters:
- `limit`: Number of results (default: 10)
- `state`: Filter by state (BUILDING, READY, ERROR, CANCELED)
- `target`: Filter by target (production, preview, development)

#### Get Deployment Details
```http
GET /api/integrations/vercel/deployments/DEPLOYMENT_ID?userId=USER_ID&organizationId=ORG_ID
```

#### Get Deployment Logs
```http
GET /api/integrations/vercel/deployments/DEPLOYMENT_ID/logs?userId=USER_ID&organizationId=ORG_ID&limit=100
```

### Domains

#### List Domains
```http
GET /api/integrations/vercel/projects/PROJECT_ID/domains?userId=USER_ID&organizationId=ORG_ID
```

### Environment Variables

#### Get Environment Variables
```http
GET /api/integrations/vercel/projects/PROJECT_ID/env?userId=USER_ID&organizationId=ORG_ID
```

#### Create Environment Variable
```http
POST /api/integrations/vercel/projects/PROJECT_ID/env?userId=USER_ID&organizationId=ORG_ID
Content-Type: application/json

{
  "key": "API_KEY",
  "value": "secret-value",
  "type": "encrypted",
  "target": ["production", "preview"]
}
```

#### Update Environment Variable
```http
PATCH /api/integrations/vercel/projects/PROJECT_ID/env/ENV_ID?userId=USER_ID&organizationId=ORG_ID
Content-Type: application/json

{
  "value": "new-value"
}
```

#### Delete Environment Variable
```http
DELETE /api/integrations/vercel/projects/PROJECT_ID/env/ENV_ID?userId=USER_ID&organizationId=ORG_ID
```

## Architecture

### Models

**VercelConnection** (`models/VercelConnection.js`)
- Multi-tenant schema (userId, organizationId)
- Encrypted access token storage
- User and team information
- Project tracking with metadata
- Health monitoring
- Status management

### Services

**vercelAuthService** (`services/vercelAuthService.js`)
- OAuth URL generation
- Token exchange
- User info retrieval
- Team info retrieval
- Connection management
- Availability checking

**vercelApiService** (`services/vercelApiService.js`)
- REST API client with axios
- Projects API
- Deployments API
- Domains API
- Environment variables API
- Team API
- Logs API

**vercelService** (`services/vercelService.js`)
- High-level orchestration
- Business logic
- Connection token management
- Health check updates
- Metrics tracking

### Routes

**index.js** (`routes/index.js`)
- Authentication endpoints
- Project endpoints
- Deployment endpoints
- Domain endpoints
- Environment variable endpoints
- "Coming soon" middleware

## Database Schema

```javascript
{
  userId: ObjectId,              // Required
  organizationId: ObjectId,      // Required
  vercelUserId: String,          // Required
  username: String,
  email: String,
  teamId: String,                // Optional (for team accounts)
  teamSlug: String,
  teamName: String,
  accessToken: String,           // Encrypted, not selected by default
  status: String,                // 'active' | 'expired' | 'disconnected' | 'error'
  projects: [{
    id: String,
    name: String,
    framework: String,
    latestDeployment: Object
  }],
  monitoredProjects: [String],
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

## Security

- **Token Encryption**: All access tokens encrypted with AES-256-GCM
- **Token Protection**: Access tokens not returned in API responses (select: false)
- **Multi-tenant Isolation**: Unique constraint on organizationId + vercelUserId
- **CSRF Protection**: State parameter in OAuth flow
- **Rate Limiting**: Applied to all API endpoints

## Team Support

The integration supports both personal and team accounts:

```javascript
// Personal account
const projects = await vercelService.listProjects(connectionId);

// Team account (uses connection's teamId)
const projects = await vercelService.listProjects(connectionId);

// Team account (override with specific teamId)
const projects = await vercelService.listProjects(connectionId, 'team_xxx');
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description"
}
```

Common status codes:
- `400`: Bad request (missing parameters)
- `403`: Forbidden (inactive connection)
- `404`: Not found (connection or resource)
- `500`: Server error
- `503`: Service unavailable (credentials not configured)

## Coming Soon Mode

When OAuth credentials are not configured:

- Auth endpoints return 503 with "coming soon" message
- Status endpoint returns availability information
- Other endpoints work normally once a connection exists

This allows the integration to be deployed before OAuth credentials are obtained.

## Testing

```bash
# Test status endpoint (should return "coming soon" if not configured)
curl http://localhost:4003/api/integrations/vercel/status?userId=USER_ID&organizationId=ORG_ID

# Test auth endpoint (should return 503 if not configured)
curl http://localhost:4003/api/integrations/vercel/auth?userId=USER_ID&organizationId=ORG_ID
```

## Migration from Deployment Integration

The old `deployment` directory has been removed and replaced with this complete Vercel integration. The new integration provides:

- Better multi-tenant support
- More comprehensive API coverage
- Better error handling
- Health monitoring
- Team support
- "Coming soon" mode

## References

- [Vercel REST API Documentation](https://vercel.com/docs/rest-api)
- [Vercel OAuth Documentation](https://vercel.com/docs/rest-api/authentication/oauth)
- [Vercel Integration Console](https://vercel.com/account/settings/integrations)

## Support

For issues or questions, contact the Flora DevOps team or check the main repository documentation.
