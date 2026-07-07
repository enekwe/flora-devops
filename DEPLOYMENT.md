# Flora DevOps Deployment Guide

## Railway Deployment (Port 4003)

### Prerequisites

1. Railway CLI installed: `npm install -g @railway/cli`
2. Railway account created
3. MongoDB Atlas or Railway MongoDB instance
4. OAuth credentials for all integrations

### Deployment Steps

#### 1. Initialize Railway Project

```bash
cd flora-devops
railway login
railway init
```

Select or create a new project named `flora-devops`.

#### 2. Link Repository

```bash
railway link
```

Link to the `enekwe/flora-devops` GitHub repository.

#### 3. Set Environment Variables

```bash
# Database
railway variables set MONGODB_URI="your-mongodb-uri"

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
railway variables set ENCRYPTION_KEY="your-64-char-hex-encryption-key"

# GitHub OAuth
railway variables set GITHUB_CLIENT_ID="your-github-client-id"
railway variables set GITHUB_CLIENT_SECRET="your-github-client-secret"
railway variables set GITHUB_CALLBACK_URL="https://flora-devops.up.railway.app/api/integrations/github/callback"
railway variables set GITHUB_WEBHOOK_SECRET="your-github-webhook-secret"

# Service Configuration
railway variables set NODE_ENV="production"
railway variables set PORT="4003"
railway variables set SERVICE_NAME="flora-devops"
railway variables set LOG_LEVEL="info"

# CORS (adjust to your frontend domains)
railway variables set ALLOWED_ORIGINS="https://your-frontend-domain.com"

# Rate Limiting
railway variables set RATE_LIMIT_WINDOW_MS="900000"
railway variables set RATE_LIMIT_MAX_REQUESTS="100"
```

#### 4. Deploy

```bash
railway up
```

#### 5. Verify Deployment

```bash
# Check deployment status
railway status

# View logs
railway logs

# Open in browser
railway open
```

#### 6. Verify Health

```bash
curl https://flora-devops.up.railway.app/health
```

Expected response:
```json
{
  "success": true,
  "service": "flora-devops",
  "status": "healthy",
  "timestamp": "2026-07-06T...",
  "uptime": 123.456,
  "environment": "production"
}
```

### OAuth App Setup

#### GitHub OAuth App

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create new OAuth App:
   - Application name: `Flora DevOps`
   - Homepage URL: `https://flora-devops.up.railway.app`
   - Authorization callback URL: `https://flora-devops.up.railway.app/api/integrations/github/callback`
3. Copy Client ID and Client Secret to Railway variables

### Port Configuration

The service runs on port 4003. Railway will automatically expose this port via their proxy.

### Environment-Specific Configuration

For staging/production environments, update callback URLs accordingly:

```bash
# Staging
GITHUB_CALLBACK_URL="https://flora-devops-staging.up.railway.app/api/integrations/github/callback"

# Production
GITHUB_CALLBACK_URL="https://devops.flora.app/api/integrations/github/callback"
```

### Monitoring

1. **Health Checks**: Railway automatically monitors `/health` endpoint
2. **Logs**: View with `railway logs`
3. **Metrics**: Available in Railway dashboard

### Troubleshooting

#### Connection Issues

```bash
# Check logs
railway logs

# Check variables
railway variables

# Restart service
railway restart
```

#### Database Connection

Verify MongoDB URI is correct:
```bash
railway variables | grep MONGODB_URI
```

#### OAuth Issues

Ensure callback URLs match exactly:
- Railway URL: Check with `railway status`
- OAuth app settings: Must match Railway URL

### Scaling

Railway automatically scales based on traffic. For manual scaling:

```bash
# View current resources
railway status

# Upgrade plan if needed
railway upgrade
```

### Backup and Recovery

1. **Database**: Ensure MongoDB has automated backups
2. **Code**: Repository is backed up on GitHub
3. **Environment Variables**: Export regularly:

```bash
railway variables > railway-env-backup-$(date +%Y%m%d).txt
```

### Updates and Maintenance

```bash
# Pull latest changes
git pull origin main

# Deploy update
railway up

# Rollback if needed
railway rollback
```

## Local Testing Before Deployment

```bash
# Install dependencies
npm install

# Set up .env file
cp .env.example .env
# Edit .env with local values

# Run locally
npm run dev

# Test health endpoint
curl http://localhost:4003/health

# Test API
curl http://localhost:4003/api
```

## Production Checklist

- [ ] MongoDB connection string configured
- [ ] Encryption key generated (64 hex chars)
- [ ] All OAuth apps created and credentials configured
- [ ] Callback URLs match deployment URL
- [ ] Webhook secrets configured
- [ ] CORS origins set correctly
- [ ] Rate limiting configured
- [ ] Logs verified
- [ ] Health check responding
- [ ] All integrations tested
- [ ] Webhook endpoints verified

## Support

For deployment issues:
- Check Railway logs: `railway logs`
- Review Railway status: `railway status`
- GitHub Issues: https://github.com/enekwe/flora-devops/issues
