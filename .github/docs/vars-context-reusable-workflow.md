# `vars` Context in Reusable Workflows — Why It Doesn't Resolve in `with:`

## What — What is the problem?

`vars.*` (GitHub Repository/Organization Variables) **does not resolve** when used inside the `with:` block of a reusable workflow call (`workflow_call`), even though GitHub documentation lists `vars` as an allowed context there.

```yaml
# ci-next.yaml — DOES NOT WORK
jobs:
  build:
    uses: ./.github/workflows/build.yaml
    with:
      sentry-org: ${{ vars.SENTRY_ORG }}          # → empty string ""
      sentry-project: ${{ vars.SENTRY_PROJECT }}  # → empty string ""
```

Result: `build.yaml` receives empty strings → passes them to the action → error:
```
Error: Environment variable SENTRY_ORG is missing an organization slug
```

---

## Who — Who is responsible for resolving context?

The GitHub Actions runtime has two distinct layers for expression evaluation:

| Layer | Runs where | Can resolve |
|-------|-----------|-------------|
| **Workflow planner** | GitHub infrastructure (server-side) | `github.*`, `needs.*`, `inputs.*`, `strategy.*`, `matrix.*` |
| **Runner** | Virtual machine (ubuntu-latest, etc.) | All contexts: `vars.*`, `secrets.*`, `env.*`, `steps.*`, `jobs.*` |

`vars.*` is only fully resolved at the **Runner layer** — where there is an actual connection to the GitHub API to fetch variables by scope (repo → org → environment).

---

## When — When are expressions evaluated?

The GitHub Actions pipeline runs through phases in order:

```
Phase 1: Workflow Dispatch
──────────────────────────
  GitHub receives the event (push, PR, workflow_dispatch...)
  Parses the entire workflow YAML
  Builds the job dependency graph

Phase 2: Workflow Planning  (server-side, BEFORE any runner is assigned)
────────────────────────────────────────────────────────────────────────
  Evaluates top-level expressions:
    - github.*      ✓  (from event payload)
    - needs.*       ✓  (from job dependency graph)
    - inputs.*      ✓  (from workflow_call inputs)
    - strategy.*    ✓  (matrix expansion)
    - vars.*        ✗  NOT resolved — no runner exists yet
                       → falls back to empty string ""

  ← this is where the `with:` block of a reusable workflow call is evaluated

Phase 3: Job Queue
──────────────────
  Each job is placed in the runner queue
  A runner is assigned to each job

Phase 4: Runner Execution  (on the virtual machine)
────────────────────────────────────────────────────
  Runner fetches the full context from the GitHub API:
    - vars.*        ✓  fetched by repo/org/environment scope
    - secrets.*     ✓  fetched and masked in logs
    - env.*         ✓
    - steps.*       ✓  built incrementally as steps execute

  `run:` steps and `uses:` composite actions execute here
```

**Conclusion:** The `with:` block of a `workflow_call` is evaluated at **Phase 2**, before any runner exists → `vars.*` has not been fetched yet → empty string.

---

## Where — Where in the codebase does the problem occur?

The problem surfaces in the **caller workflow** (`ci-next.yaml`), specifically inside the `with:` block:

```yaml
jobs:
  build:
    uses: ./.github/workflows/build.yaml  # reusable workflow call
    with:                                  # ← evaluated at Phase 2 (server-side)
      sentry-org: ${{ vars.SENTRY_ORG }}  # ← vars.* has no value yet
```

By contrast, inside the **called workflow** (`build.yaml`), using `vars.*` inside a `run:` step works fine because that step executes at Phase 4:

```yaml
# build.yaml — works fine inside a run: step
jobs:
  sentry:
    steps:
      - run: echo ${{ vars.SENTRY_ORG }}  # ← Phase 4, runner is present → OK
```

---

## Why — Why does GitHub work this way?

### 1. Scope ambiguity of `vars` in reusable workflows

When `ci-next.yaml` (caller) calls `build.yaml` (called), the two workflows can belong to **different repositories** (cross-repo reusable workflow). In that case:

- `vars.SENTRY_ORG` in the caller → variable from the **caller's repo**
- `vars.SENTRY_ORG` in the called workflow → variable from the **called workflow's repo**

The GitHub runtime cannot determine which scope is correct at Phase 2 because it does not yet have the full context. Rather than guessing, GitHub leaves the value empty.

Even within the same repository (same-repo reusable workflow), GitHub applies the same evaluation model to guarantee consistency across all use cases.

### 2. `vars` requires a runner to fetch

`vars.*` is not static configuration — values are fetched dynamically from the GitHub API following a **scope chain**:

```
Environment variables  (if the job declares environment:)
        ↓  override
Repository variables   (Settings → Secrets and variables → Variables)
        ↓  override
Organization variables (Organization → Settings → Variables)
```

This scope chain can only be resolved when:
- The job's environment is known (only determined when the job starts)
- A runner identity exists to authenticate against the GitHub API
- → This is only available at **Phase 4**

### 3. Why `secrets.*` is different

`secrets.*` must also be explicitly declared in the `secrets:` block of a reusable workflow, but values are passed through a **dedicated secure channel** that bypasses the expression evaluation engine entirely — so this problem does not apply to them.

---

## How — The solution and why it works

### Solution: Reusable workflow `resolve-env.yaml`

```yaml
# resolve-env.yaml
jobs:
  resolve:
    runs-on: ubuntu-latest           # ← runner is assigned → Phase 4
    steps:
      - id: env
        env:
          SENTRY_ORG_VAR: ${{ vars.SENTRY_ORG }}  # ← resolved at Phase 4 ✓
        run: |
          echo "sentry-org=${SENTRY_ORG_VAR}" >> "$GITHUB_OUTPUT"
```

```yaml
# ci-next.yaml
jobs:
  resolve:
    uses: ./.github/workflows/resolve-env.yaml  # runs first
    with:
      prefix: fe

  build:
    needs: [resolve]
    uses: ./.github/workflows/build.yaml
    with:
      sentry-org: ${{ needs.resolve.outputs.sentry-org }}  # ← needs.* resolves at Phase 2 ✓
```

**Why this works:**

```
Phase 2 (server-side):
  - resolve job is queued
  - build job sees needs: [resolve] → waits

Phase 4 (runner — resolve job):
  - vars.SENTRY_ORG is fetched from the GitHub API ✓
  - written to GITHUB_OUTPUT
  - resolve job completes, outputs are exposed

Phase 2 again (server-side — build job is unblocked):
  - needs.resolve.outputs.sentry-org now has the real value ✓
  - with: of build is evaluated with the correct value ✓

Phase 4 (runner — build job):
  - inputs.sentry-org = "chientech-innovations" ✓
```

### Comparison of approaches

| Approach | `vars.*` resolves? | Why |
|----------|--------------------|-----|
| `with: ${{ vars.X }}` directly | ✗ | Phase 2, no runner yet |
| `run: echo ${{ vars.X }}` in a job step | ✓ | Phase 4, runner is present |
| Job A writes to `GITHUB_OUTPUT` → Job B reads `needs.A.outputs.*` | ✓ | Output from Phase 4, passed via `needs.*` (Phase 2 OK) |
| Composite action with a `run:` step | ✓ | Runs inside a job context → Phase 4 |
| Reusable workflow with a `run:` step | ✓ | Job has its own runner → Phase 4 |
| Hardcoded value in YAML | ✓ | No resolution needed |

### Why the composite action `output-env` could not be used

A composite action runs **inside** a job — that job must complete before its outputs are known. In the old flow:

```
ci-next.yaml:
  docker job:
    steps:
      - uses: ./.github/actions/output-env   ← runs inside docker job
    needs: [build, security]                 ← but build needs sentry vars before that!
```

The `output-env` outputs only existed inside the `docker` job — they could not be passed back up to the `build` job because `build` must run before `docker`. That would be a circular dependency.

A reusable workflow creates an **independent job** that runs before both `build` and `docker`. Its outputs are available to all downstream jobs via `needs.*`.

---

## Full flow diagram

```
GitHub Event (push / PR)
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  Phase 2: Workflow Planning (server-side)            │
│                                                      │
│  resolve ──────────────────────────────────────►    │
│                                                      │
│  build ──── needs: [resolve] ──────────────────►    │
│                                                      │
│  security ──────────────────────────────────────►   │
│                                                      │
│  docker ── needs: [resolve, build, security] ───►   │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  Phase 4: Runner Execution                           │
│                                                      │
│  [resolve job] ← runner assigned                    │
│    → fetch vars.SENTRY_ORG from GitHub API ✓        │
│    → write to GITHUB_OUTPUT                         │
│    → done, outputs exposed                          │
│          │                                          │
│          ▼                                          │
│  [build job] ← needs.resolve.outputs available ✓   │
│  [security job] ← runs in parallel                  │
│          │                                          │
│          ▼                                          │
│  [docker job] ← needs.resolve.outputs available ✓  │
└─────────────────────────────────────────────────────┘
```

---

## Appendix — GitHub Variable Scopes: Repository, Organization, Environment

### Three types of variables and where they are declared

```
GitHub Organization
│
│  Organization Variables          Settings → Secrets and variables → Variables
│  (apply to all repos)            e.g. SENTRY_ORG = "chientech-innovations"
│
├── Repository A
│     Repository Variables         Settings → Secrets and variables → Variables
│     (override org if same name)  e.g. AWS_REGION = "us-east-1"
│
│     ├── Environment: staging
│     │     Environment Variables  Settings → Environments → staging → Variables
│     │     (override repo if same name)
│     │     e.g. API_URL = "https://staging.api.example.com"
│     │
│     └── Environment: production
│           Environment Variables
│           e.g. API_URL = "https://api.example.com"
│
└── Repository B
      Repository Variables
      e.g. AWS_REGION = "ap-southeast-1"   ← different from Repository A
```

### Scope chain when a runner fetches `vars.*`

The runner fetches variables in priority order from **narrowest → broadest**. A narrower scope overrides a broader one:

```
1. Environment variables   (if the job declares environment:)
         ↓  fallback if not found
2. Repository variables
         ↓  fallback if not found
3. Organization variables
         ↓  fallback if not found
4. "" (empty string)
```

Real example — the `docker` job in `ci-next.yaml` declares `environment: HUB`:

```yaml
docker:
  environment: HUB      # ← GitHub fetches vars in scope: HUB env → repo → org
  steps:
    - run: echo ${{ vars.AWS_OIDC_ROLE }}
```

If `AWS_OIDC_ROLE` is set at both the repository level and the `HUB` environment, the **environment value wins**.

### `vars.*` vs `secrets.*`

| | `vars.*` | `secrets.*` |
|---|---|---|
| Value | Plain text, visible in the UI | Encrypted, masked in logs |
| Use for | Non-sensitive config (slugs, URLs, regions) | Credentials, tokens, private keys |
| Override scope | Org → Repo → Environment | Org → Repo → Environment (same) |
| Declaration in reusable workflow | Not required (resolved automatically) | Must be declared in the `secrets:` block |
| Passing via `with:` | Does not resolve at Phase 2 (the problem above) | Passed via a dedicated secure channel |

### Why `secrets.*` is not affected by the Phase 2 problem

Secrets are passed through a **dedicated encrypted channel** — they bypass the expression evaluation engine entirely. When a caller declares:

```yaml
secrets:
  SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

GitHub does not evaluate `${{ secrets.SENTRY_AUTH_TOKEN }}` as a regular expression. Instead, it copies the encrypted value directly into the called workflow's context through the secure channel. The called workflow then decrypts the value at Phase 4 on the runner.

`vars.*` has no such dedicated channel — it is an ordinary context object subject to Phase 2 evaluation timing.

### When to use each type

```
vars.*  (Repository / Organization Variables)
├── Use when: non-sensitive values that may differ per environment
├── Examples: SENTRY_ORG, SENTRY_PROJECT, AWS_REGION, ECR_REPOSITORY
└── Note: does not resolve in with: of reusable workflows → use resolve-env pattern

secrets.*  (Repository / Organization Secrets)
├── Use when: credentials, tokens, private keys
├── Examples: SENTRY_AUTH_TOKEN, AWS_SECRET_ACCESS_KEY, DATABASE_URL
└── Note: must be explicitly declared in the secrets: block of reusable workflows

env:  (job-level environment variables)
├── Use when: values only needed within a single job and not shared
├── Examples: BUILD_CONTEXT, BUILD_DOCKERFILE in ci-next.yaml
└── Note: only available inside that job; not part of the vars.* context
```

### How `environment:` on a job changes variable scope

`environment:` on a job is not just a label — it changes the **scope used to resolve both vars and secrets**:

```yaml
jobs:
  docker:
    environment: HUB      # ← resolves vars/secrets from the "HUB" environment first
    steps:
      - run: echo ${{ vars.AWS_OIDC_ROLE }}
      # GitHub searches in order:
      # 1. HUB environment variable AWS_OIDC_ROLE  → found → use it
      # 2. Repository variable AWS_OIDC_ROLE        → found → use it
      # 3. Organization variable AWS_OIDC_ROLE      → found → use it
      # 4. "" empty string

  build:
    # no environment: declared → only repo + org scope is searched
    steps:
      - run: echo ${{ vars.AWS_OIDC_ROLE }}
      # 1. Repository variable  → found → use it
      # 2. Organization variable → found → use it
      # 3. "" empty string
```

This is why `vars.AWS_OIDC_ROLE` inside the `docker` job (which has `environment: HUB`) can return a different value than the same expression inside a job without an environment.

### Variable setup in this repository

```
Organization: chientech-innovations
  vars:
    SENTRY_ORG = "chientech-innovations"         ← shared across all repos

Repository: essay
  vars:
    SENTRY_PROJECT_FRONTEND = "javascript-nextjs"
    AWS_REGION = "us-east-1"

  Environment: HUB
    vars:
      AWS_OIDC_ROLE = "arn:aws:iam::xxx:role/github-actions-role"
      ECR_REPOSITORY = "ecr-global-api"
```

When `resolve-env.yaml` runs (no `environment:` declared):
- `vars.SENTRY_ORG` → repo: not found → org: "chientech-innovations" ✓
- `vars.SENTRY_PROJECT_FRONTEND` → repo: "javascript-nextjs" ✓

When the `docker` job runs (with `environment: HUB`):
- `vars.AWS_OIDC_ROLE` → HUB environment: "arn:aws:iam::xxx:role/..." ✓

---

## Summary rule

> **`vars.*` only resolves when the expression is evaluated at Phase 4 — on an actual runner. Any expression that GitHub evaluates server-side at Phase 2 has no access to `vars.*`.**
>
> **The standard pattern:** use a `run:` step to capture `vars.*` into `GITHUB_OUTPUT`, expose the values as job outputs, and pass them downstream via `needs.<job>.outputs.*`.
