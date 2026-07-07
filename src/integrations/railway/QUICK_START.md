# Railway Integration - Quick Start Guide

Get up and running with the Railway integration in 5 minutes.

## Prerequisites

- Railway account (https://railway.app)
- Flora DevOps service running
- MongoDB connection configured
- ENCRYPTION_KEY set in environment

## Step 1: Get Railway OAuth Credentials (2 minutes)

1. Go to https://railway.app/account/oauth-apps
2. Click "Create OAuth App"
3. Fill in:
   - **Name**: Flora DevOps
   - **Callback URL**: `http://localhost:4003/api/integrations/railway/callback`
   - **Description**: Flora CMS/Commerce Railway Integration
4. Click "Create"
5. Copy the **Client ID** and **Client Secret**

## Step 2: Configure Environment (1 minute)

Add to your `.env` file:

```bash
# Railway OAuth
RAILWAY_CLIENT_ID=your-client-id-here
RAILWAY_CLIENT_SECRET=your-client-secret-here
RAILWAY_CALLBACK_URL=http://localhost:4003/api/integrations/railway/callback
```

## Step 3: Restart Service (30 seconds)

```bash
cd /Users/cope/Passbook_Oracle/microservices/flora-devops
npm run dev
```

## Step 4: Test Integration (1 minute)

### Check Status

```bash
curl "http://localhost:4003/api/integrations/railway/status?userId=test-user&organizationId=test-org"
```

Should return:
```json
{
  "success": true,
  "data": {
    "available": true,
    "connected": false
  }
}
```

### Generate Auth URL

```bash
curl "http://localhost:4003/api/integrations/railway/auth?userId=test-user&organizationId=test-org"
```

Response:
```json
{
  "success": true,
  "authUrl": "https://railway.app/oauth?client_id=...",
  "state": "csrf-token"
}
```

## Step 5: Connect Your Account (1 minute)

1. Copy the `authUrl` from Step 4
2. Open it in your browser
3. Click "Authorize" on Railway
4. You'll be redirected to the callback URL
5. Check the response - should show successful connection

## Verify Connection

```bash
curl "http://localhost:4003/api/integrations/railway/status?userId=test-user&organizationId=test-org"
```

Should now show:
```json
{
  "success": true,
  "data": {
    "available": true,
    "connected": true,
    "railwayUserId": "...",
    "username": "your-username",
    "email": "your-email@example.com",
    "status": "active",
    "projectCount": 0
  }
}
```

## Usage Examples

### List Projects

```bash
curl "http://localhost:4003/api/integrations/railway/projects?userId=test-user&organizationId=test-org"
```

### Get Project Details

```bash
curl "http://localhost:4003/api/integrations/railway/projects/PROJECT_ID?userId=test-user&organizationId=test-org"
```

### List Services

```bash
curl "http://localhost:4003/api/integrations/railway/projects/PROJECT_ID/services?userId=test-user&organizationId=test-org"
```

### Trigger Deployment

```bash
curl -X POST "http://localhost:4003/api/integrations/railway/services/SERVICE_ID/deployments?userId=test-user&organizationId=test-org"
```

### Set Environment Variables

```bash
curl -X POST "http://localhost:4003/api/integrations/railway/services/SERVICE_ID/env?userId=test-user&organizationId=test-org" \
  -H "Content-Type: application/json" \
  -d '{
    "NODE_ENV": "production",
    "API_KEY": "secret-key"
  }'
```

## Production Deployment

### Update Callback URL

1. Go back to https://railway.app/account/oauth-apps
2. Edit your OAuth app
3. Update callback URL to your production domain:
   ```
   https://your-production-domain.com/api/integrations/railway/callback
   ```

### Update Environment Variables

```bash
RAILWAY_CLIENT_ID=your-client-id
RAILWAY_CLIENT_SECRET=your-client-secret
RAILWAY_CALLBACK_URL=https://your-production-domain.com/api/integrations/railway/callback
```

### Deploy

```bash
npm run build
npm run deploy
```

## Troubleshooting

### "Railway integration coming soon"

**Problem**: OAuth credentials not configured
**Solution**: Add RAILWAY_CLIENT_ID and RAILWAY_CLIENT_SECRET to .env

### "Railway connection not found"

**Problem**: User hasn't connected their account yet
**Solution**: Complete OAuth flow via /auth endpoint

### "Token refresh failed"

**Problem**: Refresh token expired or invalid
**Solution**: User needs to reconnect their Railway account

### GraphQL errors

**Problem**: Invalid query or permissions
**Solution**: Check Railway account permissions and query syntax

## Next Steps

- Read the full documentation: `README.md`
- Check the integration status: `RAILWAY_INTEGRATION_COMPLETE.md`
- Set up webhooks for deployment events
- Configure monitoring and alerting
- Integrate with your frontend application

## Support

- Railway API Docs: https://docs.railway.app/reference/public-api
- Flora DevOps Issues: https://github.com/enekwe/flora-devops/issues
- Railway Support: https://railway.app/help

## Quick Reference

### Environment Variables
```bash
RAILWAY_CLIENT_ID          # Required - OAuth client ID
RAILWAY_CLIENT_SECRET      # Required - OAuth client secret
RAILWAY_CALLBACK_URL       # Required - OAuth callback URL
```

### Base URLs
- **OAuth**: https://railway.app/oauth
- **Token**: https://railway.app/oauth/token
- **GraphQL API**: https://backboard.railway.app/graphql/v2

### Key Endpoints
- Auth: `/api/integrations/railway/auth`
- Status: `/api/integrations/railway/status`
- Projects: `/api/integrations/railway/projects`
- Services: `/api/integrations/railway/services/:serviceId`
- Deployments: `/api/integrations/railway/deployments/:deploymentId`

### Required Parameters
All endpoints require:
- `userId` - User ID (query parameter)
- `organizationId` - Organization ID (query parameter)

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

Error response:
```json
{
  "success": false,
  "message": "Error description"
}
```

---

**That's it!** You now have a fully functional Railway integration. Start building!
