# Flora App Kit (flora-devops module)

App Kit is the **build engine** the devops delivery plane invokes to turn a
Command Center custom-app request into a running, governed application.

Full design: [`../../FLORA_APP_KIT_ARCHITECTURE.md`](../../FLORA_APP_KIT_ARCHITECTURE.md).
Command Center contract: `flora-command-center/APP_KIT_PROJECT_CONTRACT.md`.

## Layout

```
appkit/
├── models/AppKitBuild.js            # build lifecycle record (multi-tenant)
├── templates/v0/index.js            # the single fixed template (minimal Express app)
├── services/
│   ├── appKitManifestService.js     # capability manifest = hard data boundary
│   ├── appKitBuildService.js        # state machine + CC callbacks + pipeline
│   ├── appKitScaffoldService.js     # renders template, pushes files to the repo
│   ├── appKitGenerateService.js     # calls CC provider brain to fill in code
│   ├── appKitIntegrityService.js    # static manifest-conformance integrity gate
│   └── appKitDeployService.js       # GitHub repo + Railway/Vercel hosting shell
└── routes/index.js                  # /api/appkit build-flow interface
```

## Endpoints (mounted at `/api/appkit`)

All three require `authenticateService` — see Config below. **This was not
always true**: for most of this feature's build-out, none of these routes had
any authentication at all, meaning any caller who could reach this service
could trigger real infra provisioning and LLM spend for an arbitrary
organizationId, and read any build's details regardless of tenant. Fixed by
requiring the same shared secret this service already sends to Command
Center (`X-API-Key: APP_KIT_SERVICE_KEY`), now enforced in both directions.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/builds` | Kick off a build (CC → devops handoff). Returns `202` + `buildId`. |
| `GET`  | `/builds/:buildId` | Current phase, drift score, deploy URL, repo. |
| `GET`  | `/builds?organizationId=&projectId=` | List builds for a tenant/project. |

## Lifecycle

```
accepted → scaffolding → generating → integrity_testing → deploying → tracking → live
                              │
                              └─(tests fail)→ blocked      (never deploys)
```

Every transition is POSTed to the request's `callbackUrl` so Command Center records
it in the project timeline / audit log.

## Status

Phases 1–5 are implemented: model, build-intake endpoint, manifest validation,
the phase state machine, CC callback wiring, template rendering, code
generation via the CC provider brain, the static manifest-conformance
integrity gate, GitHub connection registration (repos are now discoverable
via `findConnectionForRepo`), a branch+PR push flow (no more direct commits
to the default branch), `driftAnalysisService` wiring (results now persist
onto `AppKitBuild` and can advance `tracking` -> `live`), and git-linked
Railway/Vercel provisioning that triggers a real first preview deploy
against the PR branch.

Still pending, see `FLORA_APP_KIT_ARCHITECTURE.md` §8 for full detail:
- Dynamic, CI-driven test execution (the scaffold ships `.github/workflows/ci.yml`,
  but nothing consumes its results yet).
- Auto-merge policy for the App Kit PR — deliberately **not** implemented;
  the PR is always left open for human review.
- Live execute-testing of the Railway/Vercel deploy path — this repo's dev
  session had no live credentials/network access to either platform, so the
  git-source-linking + first-deploy-trigger code is wired against each
  platform's documented request/mutation shape but has not been run against
  a real account.

## Config

```bash
COMMAND_CENTER_API_URL=          # CC base URL (generate + data broker + callbacks)
APP_KIT_TEMPLATE_VERSION=        # pinned opinionated-stack version
APP_KIT_DEFAULT_DEPLOY_TARGET=   # railway | vercel
APP_KIT_SERVICE_KEY=             # shared secret gating /builds and /builds/:id — MUST match
                                  # the same env var on flora-command-center exactly. Every
                                  # caller (CC's /requests proxy, flora-mcp-server's
                                  # app_kit/build tool) must send it as X-API-Key.
```
