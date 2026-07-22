# Flora App Kit (flora-devops module)

App Kit is the **build engine** the devops delivery plane invokes to turn a
Command Center custom-app request into a running, governed application.

Full design: [`../../FLORA_APP_KIT_ARCHITECTURE.md`](../../FLORA_APP_KIT_ARCHITECTURE.md).
Command Center contract: `flora-command-center/APP_KIT_PROJECT_CONTRACT.md`.

## Layout

```
appkit/
├── models/AppKitBuild.js            # build lifecycle record (multi-tenant)
├── services/
│   ├── appKitManifestService.js     # capability manifest = hard data boundary
│   └── appKitBuildService.js        # state machine + CC callbacks
└── routes/index.js                  # /api/appkit build-flow interface
```

## Endpoints (mounted at `/api/appkit`)

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

This is the **skeleton**: model, build-intake endpoint, manifest validation, the
phase state machine, and CC callback wiring are implemented. The external effects
of each phase (template render, code generation via the CC provider brain,
data-integrity tests, and deploy via the GitHub + Railway/Vercel services) are
marked with `TODO(appkit-phase-N)` in `appKitBuildService.js` and land in the
phases described in the architecture doc §8.

## Config

```bash
COMMAND_CENTER_API_URL=          # CC base URL (generate + data broker + callbacks)
APP_KIT_TEMPLATE_VERSION=        # pinned opinionated-stack version
APP_KIT_DEFAULT_DEPLOY_TARGET=   # railway | vercel
```
