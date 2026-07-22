# Flora App Kit — Architecture & Build-Flow Specification

**Status:** Phases 1–5 implemented — see `src/appkit/` (model, build-flow interface,
manifest validation, phase state machine, CC callbacks, opinionated template +
scaffold/generate/static-integrity pipeline, deploy orchestration, GitHub
connection registration, branch+PR push, `driftAnalysisService` wiring, and
git-linked Railway/Vercel provisioning with a triggered first preview deploy).
Remaining gaps (dynamic CI-driven test execution, auto-merge policy, live
execute-testing of the Railway/Vercel deploy path) are flagged per §8.
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
│   └── v0/                       # the single fixed template (minimal Express
│       └── index.js              #   app) + baked-in data-integrity test scaffold
├── services/
│   ├── appKitBuildService.js     # orchestrates scaffold→generate→integrity→deploy→track
│   ├── appKitScaffoldService.js  # renders template, pushes files to the repo
│   ├── appKitGenerateService.js  # calls Command Center provider brain to fill code
│   ├── appKitIntegrityService.js # static manifest-conformance check (v0 integrity gate)
│   ├── appKitDeployService.js    # GitHub repo + Railway/Vercel hosting shell
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
2. **Deploy orchestration over existing GitHub + Railway/Vercel services — done.**
   `appKitDeployService.js` creates the GitHub repo and a Railway project/service
   or Vercel project via the existing integration services, and injects the
   scoped CC app token into the target's env vars.
3. **Opinionated template + baked-in data-integrity tests; gate deploy on
   them — done (v0).**
   - `src/appkit/templates/v0/` renders the single fixed stack (minimal Express
     app, `src/appKitClient.js` scoped data client, `tests/data-integrity.test.js`,
     `.github/workflows/ci.yml`, `package.json`, `README.md`).
   - `appKitScaffoldService.js` renders the template and pushes it into the
     build's repo (`githubRepoService.createOrUpdateFile`, new in phase 3).
   - `appKitGenerateService.js` calls Command Center's provider-brain endpoint
     (`POST /api/command-center/appkit/generate`) and splices the result into
     the scaffolded example route. That endpoint's response shape is owned by a
     different workstream and wasn't finalized when this landed, so parsing is
     defensive (`code`/`raw`/`content`/`files` fields, one level of `{ data }`
     nesting) and degrades to the template's placeholder route rather than
     failing the build outright.
   - **Repo creation moved from `deploying` to the start of `scaffolding`**
     (`appKitDeployService.createGitHubRepo`, called directly from
     `appKitBuildService.runPipeline`) because the repo must exist before any
     template file can be pushed into it. Rendered files are held in memory for
     the rest of the pipeline and pushed only once `integrity_testing` passes,
     so a `blocked` build never has non-conforming code pushed to GitHub.
     `deploying` now only provisions the hosting shell
     (`appKitDeployService.provisionHostingShell`) against a repo that already
     has real, requirements-relevant source in it — see the ordering comment on
     `runPipeline` for the full reasoning.
   - **`integrity_testing` is a static manifest-conformance check, not dynamic
     test execution.** `appKitIntegrityService.js` extracts every
     `callAppKit('op', ...)` the generated source actually calls and
     cross-checks each one against `appKitManifestService.isOperationAllowed`.
     A call the manifest doesn't cover transitions the build to `blocked` (now
     actually reachable) instead of `deploying`. Actually running the
     template's Jest suite — executing LLM-generated, attacker-influenceable
     code — was deliberately left out of this live server process (would need
     `child_process`/`npm install` here, a real code-execution-surface decision
     out of scope for this increment).
   - **Still pending:** real dynamic, CI-driven test execution — a webhook from
     the `.github/workflows/ci.yml` this scaffold ships back into
     `integrity_testing` (or a post-deploy gate) — as a stronger check layered
     on top of the static one above.
4. **Repo discoverability, branch+PR flow, drift wiring, and real first
   deploy — done, with caveats below.**
   - **GitHub connection registration.** `githubRepoService.createRepository`
     never registered the new repo anywhere on the org's `GitHubConnection` —
     only a full `listRepositories()` resync did, via `connection.addRepository()`.
     `appKitDeployService.registerRepoOnConnection` now runs right after repo
     creation and calls `connection.addMonitoredRepository(repoId)` — deliberately
     *not* `addRepository()`, which writes to a `repositories` field nothing
     else reads. This is best-effort/non-fatal: a registration failure does not
     fail the build.
   - **Bug fix, uncovered while wiring the above:** `findConnectionForRepo` in
     `src/webhooks/routes.js` was comparing `accessibleRepositories` (an array
     of `{ fullName, ... }` subdocuments) and `monitoredRepositories` (an array
     of numeric repo IDs) both against `repoFullName` with `$in` — a type
     mismatch on both branches that made the lookup a silent no-op regardless
     of registration. Fixed to match `accessibleRepositories.fullName` (dot
     notation) and `monitoredRepositories` against the numeric
     `repository.id` from the webhook payload. Without this fix, repo
     registration alone would not have made anything discoverable.
   - **Branch + PR instead of a direct push to default.**
     `appKitScaffoldService.pushFiles` now creates a branch
     (`app-kit/<buildId>`) off the repo's default branch, pushes all files to
     it (`githubRepoService.createOrUpdateFile`'s existing `branch` param —
     no signature change needed there), and opens a PR back to default via a
     new `githubRepoService.createPullRequest`. The PR is **left open — no
     auto-merge**. Auto-merge is a materially different, more consequential
     decision (bypassing human review of LLM-generated code before it lands
     on default) and is explicitly flagged here as a next step for a human
     decision, not implemented. `AppKitBuild.branch`/`AppKitBuild.prNumber`
     record the result for later phases/webhooks.
   - **`driftAnalysisService` now actually fires for App Kit builds**, because
     something finally opens a PR. Its existing `pull_request` webhook gate in
     `src/webhooks/routes.js` was already wired and untouched aside from the
     lookup-bug fix above.
   - **Drift results are now persisted onto `AppKitBuild`.** The webhook
     handler's fire-and-forget `analyzePullRequest(...).then(...)` previously
     only logged. It now looks up `AppKitBuild.findOne({ repo: repoFullName })`
     (unique field) and records `driftScore`/`driftStatus`; if the build is in
     `tracking` and `driftAnalysisService`'s own `driftStatus === 'aligned'`
     (its existing threshold logic, not re-derived here), it advances to
     `live` via `appKitBuildService.advance()` so the CC callback still fires.
     Otherwise the score is recorded and the build stays in `tracking`.
   - **Real first deploy (preview, against the PR branch).** Both
     `railwayApiService.createService` and the Vercel project-creation path
     now accept a git source. Railway's `serviceCreate` GraphQL mutation gained
     an optional `source: ServiceSourceInput` variable
     (`{ repo: "owner/repo" }`); Vercel's `createProject` call now includes
     `gitRepository: { type: 'github', repo }` (that field was already a
     generic passthrough in `vercelApiService.createProject`, so no signature
     change was needed there — only in what `appKitDeployService` sends).
     After linking, Railway calls the pre-existing (previously unused from App
     Kit) `railwayService.triggerDeployment`; Vercel gets a new
     `vercelService.createDeployment` passthrough (mirroring how
     `createProject` was added) called with `gitSource: { type: 'github',
     org, repo, ref: branch }` to target the PR branch specifically. Both
     deploy targets are **preview deploys against the unmerged PR branch**,
     which is the correct target given the PR is intentionally left open, not
     a workaround.
   - **Honesty check — what is and isn't verified:** this was built with no
     live Railway or Vercel credentials/network access in-session, so none of
     this was execute-tested end to end. Vercel's request shapes
     (`gitRepository` on project creation, `gitSource` on deployment creation)
     were confirmed against Vercel's public REST API reference docs during
     this session and are high-confidence. Railway's shape is lower-confidence:
     the public docs page for the GraphQL API describes how to authenticate
     and use introspection, but doesn't publish the `ServiceSourceInput` field
     list outside of an authenticated GraphiQL session, which this session
     didn't have. The `source: { repo }` shape is taken as given rather than
     independently confirmed. Also unconfirmed: whether `serviceCreate` can
     pin a specific branch at creation (only `repo` is used) — Railway will
     build from whatever branch its source resolves to by default, not
     necessarily the App Kit PR branch. Pinning that precisely would need a
     further Railway API call this session couldn't identify with confidence;
     flagged here rather than guessed at.
5. Expose the build flow as flora-mcp-server tools / a skill so NL requests drive it.
