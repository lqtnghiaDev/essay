# CI/CD & DevSecOps

## Structure

```
.github/
├── ISSUE_TEMPLATE/
│   └── cicd-approval.yml          ← Manual approval gate issue template
├── actions/
│   ├── build-push-ecr/            ← Build Docker image → ECR + Trivy image scan
│   ├── dast-scan/                 ← OWASP ZAP baseline scan (post-deploy)
│   ├── output-env/                ← Shared AWS region + ECR repo outputs
│   ├── perf-test/                 ← k6 load test (post-deploy)
│   ├── sca-scan/                  ← Trivy FS scan + Snyk SCA (dependency audit)
│   └── sentry-release/            ← Sentry release + sourcemap upload
└── workflows/
    ├── ci.yml                     ← Reusable: lint, test/coverage, SCA scan
    ├── build-nest.yml             ← BE: CI → build & push image to ECR
    ├── build-next.yml             ← FE: CI → build & push image to ECR
    ├── _deploy.yml                ← Reusable: ECS deploy + DAST + perf test
    └── release.yml                ← Tag-triggered: build both + prod deploy + Sentry
```

---

## Workflow Triggers

| Workflow | Trigger |
|---|---|
| `build-nest.yml` | Push/PR to `main`/`develop` with changes in `be/` |
| `build-next.yml` | Push/PR to `main`/`develop` with changes in `fe/` |
| `release.yml` | Git tag matching `v*.*.*` |
| `_deploy.yml` | Called by `release.yml` (and any future caller) |
| `ci.yml` | Called by `build-nest.yml` and `build-next.yml` |

Both build workflows also support `workflow_dispatch` for manual runs.

---

## Pipeline Flow

### Branch push / PR (`build-nest.yml` / `build-next.yml`)

```
push / PR
  └─ ci.yml (reusable)
       ├─ lint-test:  install → lint → test/coverage → upload coverage artifact
       └─ sca-scan:   Trivy FS scan + Snyk SCA → SARIF → GitHub Security tab
  └─ build (needs: ci)
       ├─ Resolve image tag  (be-<branch>-<sha> or be-pr-<N>-<sha>)
       ├─ build-push-ecr:
       │    OIDC → ECR login → Buildx (GHA layer cache) → push
       │    └─ Trivy image scan → SARIF → GitHub Security tab
       └─ outputs: image-uri, image-tag, region
```

### Release tag (`release.yml`)

```
push v*.*.*
  ├─ build-backend    (parallel)  →  ECR: internship/backend:<tag>
  ├─ build-frontend   (parallel)  →  ECR: internship/frontend:<tag>
  │    └─ bakes NEXT_PUBLIC_API_BASE_URL_PRODUCTION at build time
  ├─ build-sourcemaps (parallel)  →  artifact: fe-sourcemaps-<tag>
  └─ deploy-production (needs: build-backend + build-frontend)
       └─ _deploy.yml (reusable)
            ├─ OIDC → ECS task-def render → ECS deploy (BE then FE)
            │    └─ waits for service stability
            └─ [optional] DAST scan + perf test if run-post-checks=true
  └─ sentry-release (needs: deploy-production + build-sourcemaps)
       └─ download sourcemap artifact → create Sentry release → upload sourcemaps
```

---

## Composite Actions

### `build-push-ecr`
OIDC auth → ECR login → Buildx build+push (GHA layer cache) → **Trivy image scan** (table + SARIF). Supports `tag-latest`, `build-args`, and multi-platform builds.

### `sca-scan`
**Trivy filesystem scan** on the app directory (SARIF uploaded to Security tab) + **Snyk SCA** scan on `package.json` (skipped if `SNYK_TOKEN` not set).

### `dast-scan`
**OWASP ZAP baseline (passive) scan** against a live URL. Uploads HTML report as artifact. Supports optional custom rules config.

### `perf-test`
**k6 load test** against a live URL. Uploads JSON results as artifact. If `K6_CLOUD_TOKEN` is set, results stream to Grafana Cloud k6. Reports p95 latency, request count, and error rate in the job summary.

### `sentry-release`
Downloads the `fe-sourcemaps-<version>` artifact, creates a Sentry release, and uploads sourcemaps with the correct `~/_next/static/chunks` URL prefix.

### `output-env`
Centralises shared env outputs (`region`, `ecr-repository`) so build workflows don't hard-code them.

---

## Image Tagging

| Context | Tag format |
|---|---|
| PR | `be-pr-<PR_NUMBER>-<SHORT_SHA>` / `fe-pr-<PR_NUMBER>-<SHORT_SHA>` |
| Branch push | `be-<safe-branch>-<SHORT_SHA>` / `fe-<safe-branch>-<SHORT_SHA>` |
| Release tag | `<semver-tag>` (e.g. `v1.2.3`) |

`tag-latest` is disabled for branch/PR builds and only enabled when explicitly set (not currently used by any caller — production is identified by semver tag).

---

## DevSecOps Controls

| Control | Tool | When | Result |
|---|---|---|---|
| Dependency audit (SCA) | Trivy FS + Snyk | Every CI run (PR & push) | SARIF → GitHub Security tab |
| Image vulnerability scan | Trivy (image) | Every image build | SARIF → GitHub Security tab |
| DAST (passive) | OWASP ZAP | Post-deploy (when `run-post-checks=true`) | HTML report artifact |
| Load / perf test | k6 | Post-deploy (when `run-post-checks=true`) | JSON artifact + optional Grafana Cloud |
| Error tracking | Sentry | Every production release | Release + sourcemaps uploaded |
| Dependency updates | Dependabot | Weekly (Monday 09:00 ICT) | Auto-PRs to `develop` |
| Production approval gate | GitHub Environment | Release tag deploy | Manual review required before ECS deploy |

---

## Dependabot

Weekly PRs (Monday 09:00 ICT, targeting `develop`):
- `be/` npm packages — minor/patch grouped as `backend-non-major`
- `fe/` npm packages — minor/patch grouped as `frontend-non-major`
- GitHub Actions — individual PRs (limit 3)

Major version bumps are intentionally ungrouped (each gets its own PR for manual review).

---

## Required GitHub Secrets & Variables

### Secrets

| Secret | Used by |
|---|---|
| `SNYK_TOKEN` | `ci.yml` → `sca-scan` action (optional — scan is skipped if absent) |
| `SENTRY_AUTH_TOKEN` | `release.yml` → `sentry-release` action |

### Variables (repository or environment)

| Variable | Used by |
|---|---|
| `AWS_OIDC_ROLE` | `build-nest.yml`, `build-next.yml`, `release.yml` (ECR push) |
| `AWS_OIDC_ROLE_PRODUCTION` | `_deploy.yml` called from `release.yml` |
| `ECS_CLUSTER_PRODUCTION` | `release.yml` deploy job |
| `ECS_BACKEND_SERVICE_PRODUCTION` | `release.yml` deploy job |
| `ECS_FRONTEND_SERVICE_PRODUCTION` | `release.yml` deploy job |
| `ECS_BACKEND_TASKDEF_PRODUCTION` | `release.yml` deploy job |
| `ECS_FRONTEND_TASKDEF_PRODUCTION` | `release.yml` deploy job |
| `NEXT_PUBLIC_API_BASE_URL_PRODUCTION` | `release.yml` frontend build (baked into image) |
| `SENTRY_ORG` | `release.yml` → `sentry-release` action |
| `SENTRY_PROJECT` | `release.yml` → `sentry-release` action |

> `AWS_OIDC_ROLE_STAGING`, `ECS_*_STAGING`, and staging deploy workflows have been removed. Staging deploys are not currently wired up — add a `deploy-staging.yml` caller and corresponding variables when needed.

---

## Concurrency

Both `build-nest.yml` and `build-next.yml` use `cancel-in-progress: true` scoped to the ref, so redundant runs on the same branch are cancelled automatically.
