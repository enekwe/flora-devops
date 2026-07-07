# Vercel Integration - Quick Start Guide

## Status: Coming Soon Mode

The integration is **fully functional** but awaiting OAuth credentials. It will return "coming soon" responses until configured.

## Setup (5 Minutes)

### 1. Get OAuth Credentials

Visit: https://vercel.com/account/settings/integrations

Create integration with:
- **Redirect URL**: `http://localhost:4003/api/integrations/vercel/callback`

Copy Client ID and Client Secret.

### 2. Configure Environment

Add to `.env`:
```env
VERCEL_CLIENT_ID=your_client_id
VERCEL_CLIENT_SECRET=your_client_secret
VERCEL_CALLBACK_URL=http://localhost:4003/api/integrations/vercel/callback
```

### 3. Restart Service

```bash
npm run dev
```

Done! The integration is now active.

## Quick Test

```bash
# Check status
curl "http://localhost:4003/api/integrations/vercel/status?userId=USER_ID&organizationId=ORG_ID"

# Get OAuth URL
curl "http://localhost:4003/api/integrations/vercel/auth?userId=USER_ID&organizationId=ORG_ID"
```

## Common Usage

### Connect Account
1. Generate OAuth URL via `/auth` endpoint
2. Redirect user to OAuth URL
3. Vercel redirects to `/callback` with code
4. Connection is automatically created

### List Projects
```bash
GET /api/integrations/vercel/projects?userId=USER_ID&organizationId=ORG_ID
```

### List Deployments
```bash
GET /api/integrations/vercel/projects/PROJECT_ID/deployments?userId=USER_ID&organizationId=ORG_ID
```

### Get Deployment Logs
```bash
GET /api/integrations/vercel/deployments/DEPLOYMENT_ID/logs?userId=USER_ID&organizationId=ORG_ID
```

### Manage Environment Variables
```bash
# List
GET /api/integrations/vercel/projects/PROJECT_ID/env?userId=USER_ID&organizationId=ORG_ID

# Create
POST /api/integrations/vercel/projects/PROJECT_ID/env
Body: { "key": "API_KEY", "value": "secret", "target": ["production"] }

# Update
PATCH /api/integrations/vercel/projects/PROJECT_ID/env/ENV_ID
Body: { "value": "new_value" }

# Delete
DELETE /api/integrations/vercel/projects/PROJECT_ID/env/ENV_ID
```

## Team Support

The integration automatically detects and supports team accounts:

```javascript
// Uses connection's team ID automatically
const projects = await vercelService.listProjects(connectionId);

// Override with specific team ID
const projects = await vercelService.listProjects(connectionId, 'team_xxx');
```

## Error Handling

All endpoints return:
```json
{
  "success": true/false,
  "data": {...} or "message": "error"
}
```

Status codes:
- `200`: Success
- `400`: Bad request
- `403`: Inactive connection
- `404`: Not found
- `500`: Server error
- `503`: Coming soon (credentials not configured)

## Architecture

```
routes/index.js          → Express routes & validation
  ↓
services/vercelService.js    → Business logic & orchestration
  ↓
services/vercelAuthService.js → OAuth & connection management
services/vercelApiService.js  → REST API client
  ↓
models/VercelConnection.js   → Database schema
```

## Security

- Tokens encrypted with AES-256-GCM
- CSRF protection via state parameter
- Multi-tenant isolation
- Rate limiting enabled
- Tokens never in responses

## Documentation

- Full docs: `README.md`
- Implementation details: `/microservices/flora-devops/VERCEL_INTEGRATION_COMPLETE.md`
- API reference: Route comments in `routes/index.js`

## Support

Questions? Check:
1. `README.md` - Complete documentation
2. `VERCEL_INTEGRATION_COMPLETE.md` - Implementation details
3. Vercel API Docs - https://vercel.com/docs/rest-api

---

**Ready to activate?** Just add OAuth credentials and restart!
