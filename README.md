# Flora DevOps Microservice

A comprehensive microservice for developer tools and version control integrations, including GitHub, GitLab, Linear, Vercel, and Netlify.

## Features

### Integrations

1. **GitHub Integration**
   - OAuth authentication with multi-tenant support
   - Repository management (list, create, update, delete)
   - Issue tracking (create, update, list, comment)
   - Deployment status tracking
   - Webhook management
   - Encrypted token storage (AES-256-GCM)

2. **GitLab Integration**
   - OAuth authentication with token refresh
   - Project management
   - Issue tracking
   - CI/CD pipeline integration
   - Merge request tracking
   - Webhook support

3. **Linear Integration**
   - OAuth authentication
   - Team management
   - Issue tracking with GraphQL API
   - Project management
   - Webhook support

4. **Vercel Integration**
   - OAuth authentication
   - Project listing
   - Deployment tracking
   - Team support

5. **Netlify Integration**
   - OAuth authentication
   - Site management
   - Deploy tracking

## Architecture

### Multi-Tenant Design

All integrations follow a strict multi-tenant architecture:

- Each connection is scoped to `userId` + `organizationId`
- OAuth tokens are encrypted using AES-256-GCM
- Tokens are marked with `select: false` in database schemas
- Support for multiple users connecting the same external account to different organizations

### Security

- AES-256-GCM encryption for all OAuth tokens
- Webhook signature verification (GitHub, GitLab, Linear)
- Rate limiting on all API endpoints
- Helmet.js for security headers
- CORS configuration
- Environment-based configuration

## Installation

### Prerequisites

- Node.js 18 or higher
- MongoDB
- Docker (optional)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/enekwe/flora-devops.git
cd flora-devops
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
   - Database connection (`MONGODB_URI`)
   - Encryption key (`ENCRYPTION_KEY`) - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - OAuth credentials for each integration
   - Webhook secrets

5. Start the development server:
```bash
npm run dev
```

### Docker

Build and run with Docker:

```bash
docker build -t flora-devops .
docker run -p 4003:4003 --env-file .env flora-devops
```

Or use Docker Compose:

```bash
docker-compose up -d
```

## API Documentation

### Health Check

```
GET /health
```

Returns service health status.

### GitHub Integration

```
GET /api/integrations/github/auth?userId={userId}&organizationId={orgId}
GET /api/integrations/github/callback?code={code}&state={state}
GET /api/integrations/github/status?userId={userId}&organizationId={orgId}
DELETE /api/integrations/github/disconnect

GET /api/integrations/github/repos?userId={userId}&organizationId={orgId}
POST /api/integrations/github/repos
GET /api/integrations/github/repos/{owner}/{repo}
PATCH /api/integrations/github/repos/{owner}/{repo}
DELETE /api/integrations/github/repos/{owner}/{repo}

GET /api/integrations/github/repos/{owner}/{repo}/issues
POST /api/integrations/github/repos/{owner}/{repo}/issues
GET /api/integrations/github/repos/{owner}/{repo}/issues/{number}

GET /api/integrations/github/repos/{owner}/{repo}/hooks
POST /api/integrations/github/repos/{owner}/{repo}/hooks
```

### GitLab Integration

```
GET /api/integrations/gitlab/auth?userId={userId}&organizationId={orgId}
GET /api/integrations/gitlab/callback?code={code}&state={state}
GET /api/integrations/gitlab/status?userId={userId}&organizationId={orgId}
DELETE /api/integrations/gitlab/disconnect

GET /api/integrations/gitlab/projects?userId={userId}&organizationId={orgId}
POST /api/integrations/gitlab/projects

GET /api/integrations/gitlab/projects/{projectId}/issues
POST /api/integrations/gitlab/projects/{projectId}/issues

GET /api/integrations/gitlab/projects/{projectId}/pipelines
POST /api/integrations/gitlab/projects/{projectId}/pipelines
GET /api/integrations/gitlab/projects/{projectId}/pipelines/{pipelineId}

GET /api/integrations/gitlab/projects/{projectId}/hooks
POST /api/integrations/gitlab/projects/{projectId}/hooks
```

### Linear Integration

```
GET /api/integrations/linear/auth?userId={userId}&organizationId={orgId}
GET /api/integrations/linear/callback?code={code}&state={state}
GET /api/integrations/linear/status?userId={userId}&organizationId={orgId}
DELETE /api/integrations/linear/disconnect

GET /api/integrations/linear/teams?userId={userId}&organizationId={orgId}

GET /api/integrations/linear/issues?userId={userId}&organizationId={orgId}
POST /api/integrations/linear/issues
PATCH /api/integrations/linear/issues/{issueId}

POST /api/integrations/linear/webhooks
```

### Vercel Integration

```
GET /api/integrations/vercel/auth?userId={userId}&organizationId={orgId}
GET /api/integrations/vercel/callback?code={code}&state={state}
GET /api/integrations/vercel/status?userId={userId}&organizationId={orgId}
DELETE /api/integrations/vercel/disconnect

GET /api/integrations/vercel/projects?userId={userId}&organizationId={orgId}
GET /api/integrations/vercel/projects/{projectId}/deployments
```

### Netlify Integration

```
GET /api/integrations/netlify/auth?userId={userId}&organizationId={orgId}
GET /api/integrations/netlify/callback?code={code}&state={state}
GET /api/integrations/netlify/status?userId={userId}&organizationId={orgId}
DELETE /api/integrations/netlify/disconnect

GET /api/integrations/netlify/sites?userId={userId}&organizationId={orgId}
GET /api/integrations/netlify/sites/{siteId}/deploys
```

### Webhooks

```
POST /api/webhooks/github
POST /api/webhooks/gitlab
POST /api/webhooks/linear
POST /api/webhooks/deployment
```

## Environment Variables

Required environment variables:

```bash
# Server
NODE_ENV=production
PORT=4003
SERVICE_NAME=flora-devops

# Database
MONGODB_URI=mongodb://localhost:27017/flora-devops

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=your-64-char-hex-key

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=https://your-domain.com/api/integrations/github/callback
GITHUB_WEBHOOK_SECRET=your-github-webhook-secret

# GitLab OAuth
GITLAB_CLIENT_ID=your-gitlab-client-id
GITLAB_CLIENT_SECRET=your-gitlab-client-secret
GITLAB_CALLBACK_URL=https://your-domain.com/api/integrations/gitlab/callback
GITLAB_WEBHOOK_SECRET=your-gitlab-webhook-secret

# Linear OAuth
LINEAR_CLIENT_ID=your-linear-client-id
LINEAR_CLIENT_SECRET=your-linear-client-secret
LINEAR_CALLBACK_URL=https://your-domain.com/api/integrations/linear/callback
LINEAR_WEBHOOK_SECRET=your-linear-webhook-secret

# Vercel OAuth
VERCEL_CLIENT_ID=your-vercel-client-id
VERCEL_CLIENT_SECRET=your-vercel-client-secret
VERCEL_CALLBACK_URL=https://your-domain.com/api/integrations/vercel/callback

# Netlify OAuth
NETLIFY_CLIENT_ID=your-netlify-client-id
NETLIFY_CLIENT_SECRET=your-netlify-client-secret
NETLIFY_CALLBACK_URL=https://your-domain.com/api/integrations/netlify/callback

# CORS
ALLOWED_ORIGINS=https://your-frontend.com,https://your-app.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## Deployment

### Railway

This microservice is configured for Railway deployment:

1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy on port 4003
4. Railway will automatically build using the Dockerfile

### Docker Production

```bash
docker build -t flora-devops:latest .
docker run -d \
  -p 4003:4003 \
  --env-file .env.production \
  --name flora-devops \
  flora-devops:latest
```

## Testing

Run tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Project Structure

```
flora-devops/
├── src/
│   ├── config/           # Configuration files
│   ├── integrations/     # Integration modules
│   │   ├── github/
│   │   │   ├── models/
│   │   │   ├── services/
│   │   │   └── routes/
│   │   ├── gitlab/
│   │   ├── linear/
│   │   └── deployment/
│   ├── middleware/       # Express middleware
│   ├── utils/            # Utility functions
│   ├── webhooks/         # Webhook handlers
│   └── index.js          # Main application
├── Dockerfile
├── docker-compose.yml
├── railway.json
├── package.json
└── README.md
```

## License

MIT

## Support

For issues and questions, please open an issue on GitHub: https://github.com/enekwe/flora-devops/issues
