# Flora DevOps Microservice

A comprehensive microservice for developer tools and version control integrations, focused on GitHub integration.

## Features

### Integrations

1. **GitHub Integration**
   - OAuth authentication with multi-tenant support
   - Repository management (list, create, update, delete)
   - Issue tracking (create, update, list, comment)
   - Deployment status tracking
   - Webhook management
   - Encrypted token storage (AES-256-GCM)

### Coming Soon

2. **Vercel Integration** (Planned)
   - OAuth authentication
   - Project listing
   - Deployment tracking
   - Team support

## Architecture

### Multi-Tenant Design

All integrations follow a strict multi-tenant architecture:

- Each connection is scoped to `userId` + `organizationId`
- OAuth tokens are encrypted using AES-256-GCM
- Tokens are marked with `select: false` in database schemas
- Support for multiple users connecting the same external account to different organizations

### Security

- AES-256-GCM encryption for all OAuth tokens
- Webhook signature verification (GitHub)
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

### Webhooks

```
POST /api/webhooks/github
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
