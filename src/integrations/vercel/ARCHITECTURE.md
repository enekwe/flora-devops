# Vercel Integration - Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Flora DevOps Microservice                       │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │                   Vercel Integration                       │    │
│  │                                                             │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐     │    │
│  │  │   Routes    │→ │   Service    │→ │ Auth Service │     │    │
│  │  │   (HTTP)    │  │  (Business)  │  │   (OAuth)    │     │    │
│  │  └─────────────┘  └──────────────┘  └──────────────┘     │    │
│  │         ↓                ↓                   ↓            │    │
│  │  ┌─────────────────────────────────────────────────┐     │    │
│  │  │        Vercel API Service (REST Client)         │     │    │
│  │  └─────────────────────────────────────────────────┘     │    │
│  │         ↓                                                 │    │
│  │  ┌─────────────────────────────────────────────────┐     │    │
│  │  │      VercelConnection Model (MongoDB)           │     │    │
│  │  └─────────────────────────────────────────────────┘     │    │
│  └───────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────────┐
│                        Vercel Platform                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │   OAuth    │  │  Projects  │  │ Deployments│  │    Logs    │   │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## OAuth Flow

```
┌──────────┐                 ┌──────────┐                 ┌──────────┐
│  Client  │                 │  Flora   │                 │  Vercel  │
│   App    │                 │ DevOps   │                 │   API    │
└────┬─────┘                 └────┬─────┘                 └────┬─────┘
     │                            │                            │
     │ 1. Request OAuth URL       │                            │
     ├───────────────────────────>│                            │
     │                            │                            │
     │ 2. Return authUrl          │                            │
     │<───────────────────────────┤                            │
     │                            │                            │
     │ 3. Redirect to Vercel      │                            │
     ├────────────────────────────┼───────────────────────────>│
     │                            │                            │
     │                            │   4. User approves         │
     │                            │                            │
     │ 5. Redirect with code      │                            │
     │<───────────────────────────┼────────────────────────────┤
     │                            │                            │
     │ 6. Send code to callback   │                            │
     ├───────────────────────────>│                            │
     │                            │ 7. Exchange code for token │
     │                            ├───────────────────────────>│
     │                            │                            │
     │                            │ 8. Return access token     │
     │                            │<───────────────────────────┤
     │                            │                            │
     │                            │ 9. Get user info           │
     │                            ├───────────────────────────>│
     │                            │                            │
     │                            │ 10. Return user data       │
     │                            │<───────────────────────────┤
     │                            │                            │
     │                            │ 11. Encrypt & save token   │
     │                            │     to MongoDB             │
     │                            │                            │
     │ 12. Return connection data │                            │
     │<───────────────────────────┤                            │
     │                            │                            │
```

## API Request Flow

```
┌──────────┐         ┌───────────┐         ┌──────────────┐
│  Client  │         │  Routes   │         │   Service    │
└────┬─────┘         └─────┬─────┘         └──────┬───────┘
     │                     │                       │
     │ GET /projects       │                       │
     ├────────────────────>│                       │
     │                     │                       │
     │                     │ Validate params       │
     │                     │                       │
     │                     │ Get connection        │
     │                     ├──────────────────────>│
     │                     │                       │
     │                     │                       │ Get token
     │                     │                       │ from DB
     │                     │                       │
     │                     │                       │ Decrypt
     │                     │                       │ token
     │                     │                       │
     │                     │                       │ Call Vercel
     │                     │                       │ API
     │                     │                       │
     │                     │ Return projects       │
     │                     │<──────────────────────┤
     │                     │                       │
     │ Return response     │                       │
     │<────────────────────┤                       │
     │                     │                       │
```

## Layer Responsibilities

### 1. Routes Layer (`routes/index.js`)
**Purpose**: HTTP interface and validation

- Request validation
- Parameter extraction
- Response formatting
- Error handling
- Coming soon middleware

**Example**:
```javascript
router.get('/projects', async (req, res) => {
  // 1. Validate userId and organizationId
  // 2. Call service layer
  // 3. Format and return response
});
```

### 2. Business Service Layer (`services/vercelService.js`)
**Purpose**: Business logic and orchestration

- Connection management
- Token retrieval
- Business logic
- Health checks
- Metrics tracking

**Example**:
```javascript
async listProjects(connectionId, teamId, options) {
  // 1. Get access token from connection
  // 2. Call API service
  // 3. Update connection cache
  // 4. Return formatted data
}
```

### 3. Auth Service Layer (`services/vercelAuthService.js`)
**Purpose**: Authentication and authorization

- OAuth URL generation
- Token exchange
- User info retrieval
- Connection CRUD
- Availability checking

**Example**:
```javascript
async connectAccount({ code, userId, organizationId }) {
  // 1. Exchange code for token
  // 2. Get user info
  // 3. Encrypt token
  // 4. Save connection
  // 5. Return connection data
}
```

### 4. API Service Layer (`services/vercelApiService.js`)
**Purpose**: Direct Vercel API communication

- REST client management
- API endpoint wrappers
- Error handling
- Team ID injection

**Example**:
```javascript
async listProjects(accessToken, teamId, options) {
  // 1. Create authenticated client
  // 2. Make API request
  // 3. Handle errors
  // 4. Return raw data
}
```

### 5. Model Layer (`models/VercelConnection.js`)
**Purpose**: Data structure and persistence

- Schema definition
- Data validation
- Indexes
- Instance methods
- Hooks (pre-save, post-save)

## Data Flow

### Write Operation (Create Environment Variable)
```
Client Request
    ↓
Routes: Validate & extract params
    ↓
Service: Get connection & token
    ↓
API Service: Call Vercel API
    ↓
Vercel API: Create variable
    ↓
API Service: Return result
    ↓
Service: Format response
    ↓
Routes: Send to client
```

### Read Operation (List Projects)
```
Client Request
    ↓
Routes: Validate & extract params
    ↓
Service: Get connection & token
    ↓
API Service: Call Vercel API
    ↓
Vercel API: Return projects
    ↓
API Service: Return raw data
    ↓
Service: Update cache & format
    ↓
Model: Save cached projects
    ↓
Service: Return formatted data
    ↓
Routes: Send to client
```

## Security Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Security Layers                    │
├─────────────────────────────────────────────────────┤
│  Rate Limiting (Express middleware)                 │
│  ↓                                                  │
│  CORS (Allowed origins only)                       │
│  ↓                                                  │
│  Parameter Validation (Routes)                     │
│  ↓                                                  │
│  Multi-tenant Isolation (organizationId check)     │
│  ↓                                                  │
│  Token Encryption (AES-256-GCM)                    │
│  ↓                                                  │
│  Token Protection (select: false)                  │
│  ↓                                                  │
│  CSRF Protection (state parameter)                 │
└─────────────────────────────────────────────────────┘
```

## Database Schema

```
VercelConnection Collection
┌─────────────────────────────────────────────────────┐
│ Multi-tenant Identifiers                            │
│  - userId (ObjectId, indexed)                       │
│  - organizationId (ObjectId, indexed)               │
│  - companyId (ObjectId, sparse, backward compat)    │
│                                                     │
│ Account Information                                 │
│  - vercelUserId (String, unique per org)            │
│  - username, email, name, avatar                    │
│  - teamId, teamSlug, teamName (optional)            │
│                                                     │
│ Security                                            │
│  - accessToken (String, encrypted, select: false)   │
│  - tokenType (String, default: 'Bearer')            │
│                                                     │
│ Cached Data                                         │
│  - projects[] (Array of project objects)            │
│  - monitoredProjects[] (Array of project IDs)       │
│                                                     │
│ Health & Metrics                                    │
│  - health.lastCheck (Date)                          │
│  - health.consecutiveFailures (Number)              │
│  - metrics.totalProjects (Number)                   │
│  - metrics.lastDeploymentAt (Date)                  │
│                                                     │
│ Metadata                                            │
│  - status (active|expired|disconnected|error)       │
│  - createdAt, updatedAt (Dates)                     │
└─────────────────────────────────────────────────────┘

Indexes:
  - Unique: organizationId + vercelUserId
  - Compound: userId + organizationId
  - Compound: companyId + status
  - Single: teamId (sparse)
  - Single: health.lastCheck
```

## Error Handling Strategy

```
┌─────────────────────────────────────────────────────┐
│                  Error Flow                         │
├─────────────────────────────────────────────────────┤
│  Try-Catch Block (Each layer)                       │
│    ↓                                                │
│  AppError (Custom error class)                      │
│    ↓                                                │
│  Logger (Winston)                                   │
│    ↓                                                │
│  Error Handler Middleware                           │
│    ↓                                                │
│  Formatted Response                                 │
│  {                                                  │
│    success: false,                                  │
│    message: "User-friendly error",                  │
│    statusCode: 400/404/500                          │
│  }                                                  │
└─────────────────────────────────────────────────────┘
```

## Coming Soon Mode

```
┌─────────────────────────────────────────────────────┐
│          Availability Check Flow                    │
├─────────────────────────────────────────────────────┤
│  Request to auth endpoint                           │
│    ↓                                                │
│  checkAvailability middleware                       │
│    ↓                                                │
│  vercelAuthService.isAvailable()                    │
│    ↓                                                │
│  Check: VERCEL_CLIENT_ID && VERCEL_CLIENT_SECRET    │
│    ↓                                                │
│  If false: Return 503 with "coming soon" message    │
│  If true: Continue to handler                       │
└─────────────────────────────────────────────────────┘
```

## Team Support Architecture

```
Connection can have:
  1. No team (personal account)
     teamId: null

  2. Single team
     teamId: "team_xxx"

  3. Multiple teams (via override)
     connection.teamId: "team_xxx"
     request.teamId: "team_yyy"

Usage:
  listProjects(connectionId)              → Uses connection.teamId
  listProjects(connectionId, null)        → Personal projects
  listProjects(connectionId, 'team_yyy')  → Override with team_yyy
```

## Caching Strategy

```
┌─────────────────────────────────────────────────────┐
│              Connection-Level Cache                 │
├─────────────────────────────────────────────────────┤
│  When listing projects:                             │
│    1. Fetch from Vercel API                         │
│    2. Store in connection.projects[]                │
│    3. Update connection.metrics                     │
│    4. Return fresh data                             │
│                                                     │
│  Cache is informational only                        │
│  Always fetch fresh data from Vercel               │
│  Cache used for metrics and monitoring             │
└─────────────────────────────────────────────────────┘
```

## Monitoring & Health

```
Health Check Process:
  1. Periodic health checks (future)
  2. Record success/failure
  3. Increment consecutiveFailures on error
  4. Reset to 0 on success
  5. Set status to 'error' after 3 failures
  6. Log error messages

Metrics Tracked:
  - totalProjects
  - totalDeployments
  - lastDeploymentAt
  - lastSyncedAt
```

## Extension Points

Future enhancements can be added by:

1. **Adding new API endpoints**: Add methods to `vercelApiService.js`
2. **Adding business logic**: Add methods to `vercelService.js`
3. **Adding routes**: Add routes to `routes/index.js`
4. **Adding webhooks**: Create new webhook handler
5. **Adding scheduled jobs**: Create cron job for health checks

## Performance Considerations

- **Database**: Indexed queries for fast lookups
- **Caching**: Connection-level project cache
- **Pagination**: Supported via limit parameter
- **Selective fields**: Only fetch needed data
- **Token reuse**: Decrypt once per request

## Scalability

- **Stateless**: No server-side sessions
- **Horizontal**: Can scale across instances
- **Database**: MongoDB supports sharding
- **Rate limiting**: Per-IP rate limits
- **Connection pooling**: MongoDB driver handles this

---

This architecture follows **clean architecture** principles with clear separation of concerns and dependency inversion.
