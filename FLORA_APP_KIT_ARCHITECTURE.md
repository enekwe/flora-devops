# Flora App Kit — Architecture & Build-Flow Specification

**Status:** Skeleton implemented — see `src/appkit/` (model, build-flow interface,
manifest validation, phase state machine, CC callbacks). External phase effects are
marked `TODO(appkit-phase-N)` per §8.
**Owning service:** `flora-devops` (App Kit ships as a module *inside* this service)
**Companion doc:** `flora-command-center/APP_KIT_PROJECT_CONTRACT.md` (the CC-side project/audit contract)

---

## 1. Purpose

Flora App Kit is the **sanctioned build engine** for turning a natural-language
feature request into a running custom application that can safely touch existing
Flora user data (Sites, Companies, cap tables, CRM) and existing systems.

It is modeled on the pattern described in Block's "From localhost to launched"
(agent writes the app, the platform guarantees safety): an **opinionated stack**,
**built-in auth/secrets/data-access controls**, **data-integrity test scaffolding
in every template**, and a **single sanctioned deploy path** — so that a request
originating from a non-engineer results in a governed, audited, tenant-isolated
app rather than an ungoverned script.

## 2. Where App Kit lives, and why

Two planes, each already exists in the codebase. App Kit adds a builder to one of
them and a contract to the other. **It is not a new standalone service.**

| Plane | Service | Responsibility |
|-------|---------|----------------|
| **Project & Collaboration** (system of record) | **Command Center** | Projects/workspaces, multiplayer file access, audit log, history, NL intake, requirements graph, and all governance (ZDR, redaction, residency, tenant isolation, BYOK). |
| **Delivery** | **flora-devops** | Scaffold → build → deploy → track. **Flora App Kit is a module here** — the builder the deployment path invokes. |

Rationale for this split:

- **The project belongs in Command Center because the audit and collaboration
  system of record already lives there** — `ZDRAuditLedger`, `TokenUsageLog`,
  and `SessionHandoff` are CC models today. Moving "the project" anywhere else
  would fight the existing schema.
- **App Kit belongs in flora-devops because building is a step in the delivery
  pipeline.** flora-devops already owns GitHub / Vercel / Railway integration and
  `driftAnalysisService`, which already scores a PR against Command Center's
  approved requirements. App Kit slots in *before* deploy in that same pipeline.
- **Governance is not duplicated.** App Kit builds; the built app reads/writes
  real data only through Command Center's governed broker, so every data touch
  lands in CC's audit ledger.

```
Command Center  (PROJECT plane — system of record)
  • project / workspace / multiplayer files / audit log / history
  • NL intake + requirements graph
  • governance: ZDR, redaction, residency, tenant-isolation, audit ledger
        │  (1) POST custom-app build request  ─────────────────────────────┐
        │      project stays in CC; fully audited                          │
        ▼                                                                  │
flora-devops  (DELIVERY plane)                                             │
  • Flora App Kit  ── (2) scaffold from opinionated template + integrity   │
  │                     tests + generate  (via CC provider brain)          │
  • (3) build/deploy/track pipeline (GitHub → Railway/Vercel)              │
  • (4) driftAnalysis ──► validates back against CC requirements ──────────┘
        │
        ▼
  running custom app ── (5) all real-data access routes back through ──► Command Center
                                          (every cap-table/CRM touch → CC audit ledger)
```

## 3. Module layout inside flora-devops

App Kit follows the existing integration conventions of this repo (multi-tenant
`userId` + `organizationId`, AES-256-GCM token storage, Joi request validation,
per-route rate limiting):

```
src/appkit/
├── models/
│   └── AppKitBuild.js            # build lifecycle record (multi-tenant)
├── templates/
│   └── <opinionated-stack>/      # the single fixed template + baked-in
│                                 #   data-integrity test scaffold
├── services/
│   ├── appKitBuildService.js     # orchestrates scaffold→test→deploy→track
│   ├── appKitScaffoldService.js  # renders template, wires scoped data client
│   ├── appKitGenerateService.js  # calls Command Center provider brain to fill code
│   └── appKitManifestService.js  # validates + persists the capability manifest
├── routes/
│   └── index.js                  # mounted at /api/appkit
└── README.md
```

Reused as-is (no duplication):
- `src/integrations/github/services/*` — repo creation, commits, webhooks.
- `src/integrations/{railway,vercel}/services/*` — deploy + track.
- `src/integrations/github/services/driftAnalysisService.js` — pre-merge gate
  (already talks to Command Center; thresholds: aligned ≥70, drifted <40).
- `src/webhooks/routes.js` — `POST /github`, `POST /deployment` deploy signals.

## 4. The build-flow interface (the CC → devops handoff)

This is the exact contract by which a Command Center project request enters the
devops deploy path. App Kit exposes it under `/api/appkit`.

### 4.1 Kick off a build

```
POST /api/appkit/builds
```

Request body — the **build request** handed over from a CC project:

```jsonc
{
  "projectId": "cc_proj_9f3a...",        // CC project = system of record; stays in CC
  "requestId": "cc_req_2b71...",         // ties to CC audit ledger (ZDRAuditLedger.requestId)
  "userId": "usr_...",                   // multi-tenant identity (from CC)
  "organizationId": "org_...",           // multi-tenant scope (from CC)
  "companyId": "cmp_...",                // authoritative-data owner (monolith Company)
  "appName": "capital-call-tracker",
  "prompt": "Build an app that lists this quarter's outstanding capital calls...",
  "manifest": {                          // the HARD BOUNDARY — see §5
    "dataScopes": [
      { "resource": "company", "id": "cmp_...", "access": "read" },
      { "resource": "site.metrics", "access": "read" }
    ],
    "systems": ["notifications"],        // may call CC-brokered systems only
    "egress": []                         // no arbitrary outbound by default
  },
  "callbackUrl": "https://command-center/.../appkit/status"   // CC status sink
}
```

Response:

```jsonc
{ "buildId": "akb_7c2d...", "status": "accepted", "phase": "scaffolding" }
```

### 4.2 Build lifecycle (phases)

App Kit advances an `AppKitBuild` record and POSTs each transition to `callbackUrl`
so CC records it in the project timeline / audit log:

```
accepted → scaffolding → generating → integrity_testing → deploying → tracking → live
                                            │
                                            └─(tests fail)→ blocked   (no deploy — Block's
                                                                       "quietly wrong" guard)
```

- **scaffolding** — `appKitScaffoldService` renders the opinionated template and
  injects a **scoped data client** bound to `manifest.dataScopes` (not raw creds).
- **generating** — `appKitGenerateService` calls the Command Center provider brain
  (`providerAbstractionLayer`) to fill in app code; token usage is logged in CC.
- **integrity_testing** — the template's baked-in data-correctness tests run.
  **Failure blocks the deploy.** This is the "easy to use and quietly wrong" guard.
- **deploying** — existing GitHub + Railway/Vercel services create the repo and ship.
- **tracking** — `driftAnalysisService` scores the result against CC requirements;
  deploy webhooks (`POST /deployment`) update status.
- **live** — app is running; all its data access is CC-brokered (§5).

### 4.3 Status read

```
GET /api/appkit/builds/:buildId      → current phase, drift score, deploy URL, repo
```

## 5. The capability manifest = the hard boundary

Every app declares, up front, exactly which data scopes and systems it needs.
That manifest is the enforcement point, mirroring Block's "apps connect only to
authoritative sources through hard boundaries":

1. **Declared, not discovered.** An app cannot request a scope at runtime that it
   didn't declare at build time.
2. **No raw credentials or DB handles.** The scaffold injects a scoped client whose
   only reachable calls are the CC-brokered ones matching the manifest.
3. **All real-data access routes through Command Center**, so ZDR policy, redaction,
   residency, and tenant isolation apply automatically and every touch is written
   to CC's audit ledger. See the companion contract for the exact broker surface.

## 6. Configuration to add (flora-devops)

`src/config/index.js` currently has no Command Center / App Kit keys (the drift
service hardcodes a default URL). Add:

```bash
COMMAND_CENTER_API_URL=          # CC base URL for generate + data broker + callbacks
APP_KIT_TEMPLATE_VERSION=        # pinned opinionated-stack version
APP_KIT_DEFAULT_DEPLOY_TARGET=   # railway | vercel
```

## 7. Non-goals

- App Kit does **not** own projects, files, collaboration, or the audit log — those
  stay in Command Center.
- App Kit does **not** re-implement auth, secrets, ZDR, redaction, residency, or
  tenant isolation — it consumes Command Center's.
- App Kit is **not** a standalone microservice — it is a module of flora-devops.

## 8. Phasing

1. `AppKitBuild` model + `POST /api/appkit/builds` + manifest validation + CC callback.
2. Deploy orchestration over existing GitHub + Railway/Vercel services; reuse
   `driftAnalysisService` as the pre-merge gate.
3. Opinionated template + baked-in data-integrity tests; gate deploy on them.
4. Expose the build flow as flora-mcp-server tools / a skill so NL requests drive it.
