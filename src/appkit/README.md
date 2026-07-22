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

Phases 1–3 are implemented: model, build-intake endpoint, manifest validation,
the phase state machine, CC callback wiring, template rendering, code
generation via the CC provider brain, the static manifest-conformance
integrity gate, and deploy via the GitHub + Railway/Vercel services. See
`FLORA_APP_KIT_ARCHITECTURE.md` §8 for what's still pending (dynamic
CI-driven test execution, `driftAnalysisService` wiring).

## Config

```bash
COMMAND_CENTER_API_URL=          # CC base URL (generate + data broker + callbacks)
APP_KIT_TEMPLATE_VERSION=        # pinned opinionated-stack version
APP_KIT_DEFAULT_DEPLOY_TARGET=   # railway | vercel
```
