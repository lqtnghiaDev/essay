# Architecture

Full-stack internship management platform. NestJS backend + Next.js frontend deployed on AWS ECS via GitHub Actions DevSecOps pipeline.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Frontend Architecture](#2-frontend-architecture)
   - [Route Structure](#route-structure)
   - [Auth & Access Control](#auth--access-control-flow)
   - [State Management](#state-management)
   - [Service Layer](#service-layer)
3. [Backend Architecture](#3-backend-architecture)
   - [Module Map](#module-map)
   - [Data Model](#data-model)
   - [Auth Flow](#auth-flow)
   - [WebSocket Gateway](#websocket-gateway)
   - [RAG Pipeline](#rag-pipeline)
   - [Observability Instrumentation](#observability-instrumentation)
4. [Infrastructure & Multi-Environment](#4-infrastructure--multi-environment)
5. [DevSecOps Pipeline](#5-devsecops-pipeline)
   - [Security Gates](#security-gates)
   - [Performance Testing](#performance-testing)
   - [Dependency Management](#dependency-management)
6. [Observability Stack](#6-observability-stack)

---

## 1. System Overview

```mermaid
graph TB
    subgraph Client
        Browser["Browser / Client"]
    end

    subgraph Frontend["Frontend — Next.js (ECS)"]
        FE["Next.js App Router\nPort 3000"]
    end

    subgraph Backend["Backend — NestJS (ECS)"]
        BE["NestJS REST API\nPort 3000"]
        WS["Socket.IO\nWebSocket"]
    end

    subgraph Data
        PG[("PostgreSQL\nTypeORM")]
        Chroma[("ChromaDB\nVector Store")]
    end

    subgraph AI["AI / LLM"]
        Gemini["Google Gemini API\nChat + Embeddings"]
        OpenAI["OpenAI API\nEmbeddings (optional)"]
        Puppeteer["Puppeteer\nDoc Extraction"]
    end

    subgraph Observability
        Jaeger["Jaeger\nTracing (OTEL)"]
        Prometheus["Prometheus\nMetrics"]
        Grafana["Grafana\nDashboards"]
        ES["Elasticsearch\nLog Storage"]
        Kibana["Kibana\nLog UI"]
        FluentBit["Fluent Bit\nLog Shipper"]
    end

    Browser -->|"HTTPS"| FE
    Browser -->|"WSS + JWT"| WS
    FE -->|"REST + Bearer token"| BE
    BE --> PG
    BE --> Chroma
    BE --> Gemini
    BE --> OpenAI
    Puppeteer -->|"extract → embed → store"| Chroma
    BE -->|"OTLP HTTP /v1/traces"| Jaeger
    FE -->|"OTLP"| Jaeger
    BE -->|"GET /metrics"| Prometheus
    Prometheus --> Grafana
    Jaeger --> Grafana
    FluentBit -->|"container logs"| ES
    ES --> Kibana
```

---

## 2. Frontend Architecture

**Stack:** Next.js 14+ App Router · TypeScript strict · TailwindCSS · Radix UI · Framer Motion · Zustand · SWR · Socket.IO client

### Route Structure

```
src/app/
├── (auth)/
│   └── login/                        # Public — no auth required
├── (protected)/
│   ├── layout.tsx                    # AuthProvider + RoleGuard wrapper
│   ├── profile/                      # All roles: personal profile
│   ├── (admin-only)/
│   │   └── admin/
│   │       ├── dashboard/            # Platform analytics
│   │       ├── users/                # User CRUD (all roles)
│   │       ├── interns/              # Intern oversight
│   │       ├── mentors/              # Mentor management
│   │       ├── attendance/           # Attendance admin view
│   │       └── reports/              # Admin reports
│   ├── (mentor-only)/
│   │   └── mentor/
│   │       ├── dashboard/            # Mentor overview
│   │       ├── attendance/           # Mark/view attendance
│   │       └── reports/              # Intern progress reports
│   ├── (intern-only)/
│   │   └── intern/
│   │       ├── dashboard/            # Personal progress
│   │       └── attendance/           # Personal attendance
│   └── (shared)/                     # All authenticated roles
│       ├── assignments/              # Task assignments
│       ├── chat/                     # AI chat (RAG-backed)
│       ├── skills/                   # Skill catalog
│       ├── tasks/                    # Task definitions
│       └── training-plans/           # Training plan browser
├── api/                              # Next.js API routes (proxy / BFF)
├── error/access-denied/
└── export/                           # PDF / report export
```

### Auth & Access Control Flow

```mermaid
flowchart TD
    Request["Incoming Request"] --> AuthProvider

    AuthProvider -->|"no token in Zustand"| Login["Redirect → /login"]
    AuthProvider -->|"token present"| RoleGuard

    RoleGuard -->|"role mismatch for route"| Denied["Redirect → /error/access-denied"]
    RoleGuard -->|"role matches"| Route["Render Page"]

    Route -->|"path = /"| Redirect["Role-based redirect\nadmin → /admin/dashboard\nmentor → /mentor/dashboard\nintern → /intern/dashboard"]

    subgraph Login Flow
        LoginPage["POST /auth/login"] -->|"{ access_token, refresh_token, user }"| Store["useAuthStore\n(Zustand + persist)"]
        Store -->|"redirectBasedOnRole()"| Dashboard
    end
```

### State Management

All stores live in `src/store/` using Zustand. `useAuthStore` uses `persist` middleware (localStorage).

| Store | State | Purpose |
|---|---|---|
| `useAuthStore` | `userDetails`, `accessToken`, `refreshToken`, `isAuthenticated`, `isHydrated` | JWT tokens, login/logout, role-based redirect |
| `useLoadingStore` | `isLoading` | Global loading spinner |
| `useToastStore` | `toasts[]` | Toast notification queue |
| `useNotificationStore` | `notifications[]` | Real-time Socket.IO notifications |
| `useSidebarStore` | `isOpen` | Sidebar collapsed/expanded |

### Service Layer

All services in `src/services/` send `Authorization: Bearer {token}` from `useAuthStore`. Pattern: async functions wrapping `fetch` against `API_URL` constant.

| Service | Backing API Module |
|---|---|
| `auth.services.ts` | `POST /auth/login`, `/auth/refresh`, `/auth/logout` |
| `user.services.ts` | `GET/POST/PATCH/DELETE /users` |
| `intern.services.ts` | `GET/POST /interns-information` |
| `assignment.services.ts` | `GET/POST/PATCH /assignments` |
| `task.services.ts` | `GET/POST/PATCH /tasks` |
| `trainingPlan.services.ts` | `GET/POST/PATCH /training-plans` |
| `attendance.services.ts` | `GET/POST /attendance` |
| `chat.services.ts` | `GET/POST /chat` |
| `skill.services.ts` | `GET/POST /skills` |
| `dashboard.services.ts` | `GET /dashboard` |
| `reports.services.ts` | `GET /reports` |
| `notification.services.ts` | Socket.IO connection + event handlers |

---

## 3. Backend Architecture

**Stack:** NestJS · TypeScript strict · TypeORM · PostgreSQL · Passport JWT · Socket.IO · ChromaDB · Gemini API · OpenTelemetry

### Module Map

```mermaid
graph LR
    subgraph Core
        Auth["auth\nJWT + Passport\nbcrypt password hash"]
        Users["users\nCRUD\nroles: admin/mentor/intern"]
        Common["common\nResponseBase envelope\ninterceptors, DTOs"]
    end

    subgraph Domain
        Plans["training-plans\nSkill-based templates\nvisibility: public/private"]
        Tasks["tasks\nTask definitions"]
        Assign["assignments\nPlan + Task + Intern\nstatus workflow"]
        Attend["attendance\nIntern attendance tracking"]
        Skills["skills\nSkill catalog"]
        Interns["interns-information\nIntern profile + mentor link"]
    end

    subgraph Intelligence
        LLM["llm\nGemini chat integration"]
        RAG["rag\nChromaDB vector store\nPuppeteer + embedding services"]
        Chat["chat\nSessions + messages"]
    end

    subgraph Platform
        Notif["notifications\nSocket.IO gateway\nper-user rooms"]
        Dash["dashboard\nAnalytics aggregation"]
        Reports["reports\nReport generation"]
        Observ["observability\nOTEL tracing\nPrometheus metrics\nPino logger"]
    end

    Auth --> Users
    Users --> Interns
    Interns --> Plans
    Plans --> Assign
    Tasks --> Assign
    Assign --> Attend
    Chat --> LLM
    LLM --> RAG
    Dash --> Assign
    Dash --> Attend
    Dash --> Interns
```

### Data Model

```mermaid
erDiagram
    User {
        uuid id PK
        string email UK
        string username UK
        string passwordHash
        string fullName
        string phoneNumber
        date dob
        string address
        enum role "admin|mentor|intern"
        enum status "active|inactive"
        bool isAssigned
        bool isDeleted
    }

    InternInformation {
        uuid id PK
        string field
        uuid internId FK
        uuid mentorId FK
        uuid planId FK
        date startDate
        date endDate
        enum status "Onboarding|InProgress|Completed|Dropped"
        bool isDeleted
    }

    TrainingPlan {
        uuid id PK
        uuid createdBy FK
        string name
        string description
        string extra
        bool isPublic
        bool isDeleted
    }

    TrainingPlanSkill {
        uuid id PK
        uuid planId FK
        uuid skillId FK
    }

    Assignment {
        uuid id PK
        uuid planId FK
        uuid taskId FK
        uuid createdBy FK
        uuid assignedTo FK
        int estimatedTime
        date dueDate
        string submittedLink
        date submittedAt
        string feedback
        enum status "Todo|InProgress|Submitted|Reviewed"
        bool isAssigned
        bool isDeleted
    }

    AssignmentSkill {
        uuid id PK
        uuid assignmentId FK
        uuid skillId FK
    }

    Task {
        uuid id PK
        string name
        string description
        string extra
        uuid createdBy FK
        bool isDeleted
    }

    User ||--o| InternInformation : "intern has"
    User ||--o{ InternInformation : "mentor supervises"
    User ||--o{ TrainingPlan : "creates"
    User ||--o{ Assignment : "creates"
    User ||--o{ Assignment : "assigned to"
    TrainingPlan ||--o{ TrainingPlanSkill : "has skills"
    TrainingPlan ||--o{ Assignment : "contains"
    TrainingPlan ||--o{ InternInformation : "assigned to interns"
    Assignment ||--o{ AssignmentSkill : "requires skills"
    Task ||--o{ Assignment : "used in"
```

### Auth Flow

```mermaid
sequenceDiagram
    participant Client
    participant AuthController
    participant AuthService
    participant UsersService
    participant JwtService

    Client->>AuthController: POST /auth/login { username, password }
    AuthController->>AuthService: validateUser(loginDto)
    AuthService->>UsersService: findByUsername(username)
    UsersService-->>AuthService: user entity
    AuthService->>AuthService: bcrypt.compare(password, passwordHash)
    AuthService->>JwtService: sign({ sub, email, role })
    JwtService-->>AuthService: access_token (default expiry) + refresh_token (7d)
    AuthService-->>Client: { access_token, refresh_token, user: { id, name, email, role } }

    Note over Client,JwtService: Subsequent requests

    Client->>AuthController: Any protected route + Authorization: Bearer {token}
    AuthController->>JwtAuthGuard: validate token
    JwtAuthGuard->>JwtStrategy: validate JWT payload
    JwtStrategy-->>JwtAuthGuard: { sub, email, role }
    JwtAuthGuard-->>AuthController: attach user to request

    Note over AuthController: Role-restricted endpoints also checked by RolesGuard
    AuthController->>RolesGuard: check @Roles() decorator vs user.role
    RolesGuard-->>AuthController: allow or 403
```

**Guards & Decorators:**

| File | Purpose |
|---|---|
| `guards/jwt-auth.guard.ts` | Validates Bearer JWT on all protected routes |
| `guards/roles.guard.ts` | Enforces `@Roles('admin', 'mentor')` decorator |
| `strategies/jwt.strategy.ts` | Passport JWT strategy — extracts payload |
| `decorators/roles.decorator.ts` | `@Roles(...roles)` metadata setter |
| `decorators/user.decorator.ts` | `@CurrentUser()` param decorator — injects user from request |

### WebSocket Gateway

`notifications.gateway.ts` — Socket.IO gateway with JWT auth on connection.

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as NotificationsGateway
    participant JwtService

    Client->>Gateway: connect (auth.token in handshake)
    Gateway->>JwtService: verify(token)
    JwtService-->>Gateway: { sub: userId, ... }
    Gateway->>Gateway: client.join(`user_${userId}`)
    Gateway-->>Client: connected to private room

    Note over Gateway: Server-side push
    Gateway->>Client: server.to(`user_${userId}`).emit(event, payload)

    Client->>Gateway: disconnect
    Gateway->>Gateway: log disconnect
```

- Each user joins room `user_{userId}` on connect
- Clients without valid JWT are immediately disconnected
- Server pushes notifications via `server.to(room).emit()`
- CORS: `localhost:3000` + Vercel deployment URL

### RAG Pipeline

```mermaid
sequenceDiagram
    participant Admin
    participant DocExtractor as document-extractor.service\n(Puppeteer)
    participant EmbedSvc as embedding.service\n(Gemini / OpenAI)
    participant IndexSvc as indexing.service
    participant VectorStore as vector-store.service\n(ChromaDB)
    participant User
    participant LLM as Gemini Chat

    Admin->>DocExtractor: submit document URL
    DocExtractor->>DocExtractor: extract + chunk text\n(chunk=600, overlap=100)
    DocExtractor->>EmbedSvc: text chunks
    EmbedSvc->>VectorStore: store vectors in collection\n"internship_management_rag"\n+ role metadata filter
    IndexSvc->>VectorStore: manage index lifecycle

    User->>LLM: chat query (with session history, limit=10 msgs)
    LLM->>EmbedSvc: embed query
    EmbedSvc->>VectorStore: similarity search (top_k=5, role-filtered)
    VectorStore-->>LLM: relevant context chunks
    LLM-->>User: grounded response via Gemini
```

**RAG constants** (`rag.constants.ts`):

| Constant | Value | Purpose |
|---|---|---|
| `RAG_COLLECTION_NAME` | `internship_management_rag` | ChromaDB collection |
| `RAG_CHUNK_SIZE` | `600` | Chars per document chunk |
| `RAG_CHUNK_OVERLAP` | `100` | Overlap between chunks |
| `RAG_TOP_K` | `5` | Retrieved chunks per query |
| `RAG_MEMORY_MESSAGE_LIMIT` | `10` | Chat history messages kept |

### Observability Instrumentation

**Tracing** (`observability/tracing.ts`):
- OpenTelemetry NodeSDK with `getNodeAutoInstrumentations()` — auto-instruments HTTP, Express, DB calls
- Exporter: OTLP HTTP → `OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces` (default: `http://localhost:4318`)
- Service name: `OTEL_SERVICE_NAME` env (default: `internship-management-be`)
- Disabled via `OTEL_ENABLED=false`

**Metrics** (`observability/metrics.ts`):
- Prometheus `prom-client` with default system metrics (`internship_management_` prefix)
- Custom histogram: `internship_management_http_request_duration_seconds` — labels: `method`, `route`, `status_code`
- Buckets: `[0.005, 0.01, 0.05, 0.1, 0.3, 1, 2, 5]` seconds
- Exposed at `GET /metrics`

**Logging** (`observability/pino-logger.config.ts`):
- Pino structured JSON logging
- Collected by Fluent Bit from Docker container stdout → Elasticsearch

---

## 4. Infrastructure & Multi-Environment

### AWS Architecture

```mermaid
graph TB
    subgraph GitHub["GitHub Actions"]
        GHA["Workflows\n(OIDC → no long-lived AWS keys)"]
    end

    subgraph AWS
        subgraph ECR["Amazon ECR"]
            ECR_BE["internship/backend"]
            ECR_FE["internship/frontend"]
        end

        subgraph ECS_STG["ECS — Staging"]
            BE_STG["Backend Service\n(task def updated per deploy)"]
            FE_STG["Frontend Service\n(task def updated per deploy)"]
        end

        subgraph ECS_PRD["ECS — Production"]
            BE_PRD["Backend Service"]
            FE_PRD["Frontend Service"]
        end
    end

    subgraph Sentry["Error Tracking"]
        SentryIO["Sentry\nSourcemaps + releases"]
    end

    GHA -->|"OIDC assume role"| ECR_BE
    GHA -->|"OIDC assume role"| ECR_FE
    ECR_BE -->|"image URI"| BE_STG
    ECR_FE -->|"image URI"| FE_STG
    ECR_BE -->|"image URI"| BE_PRD
    ECR_FE -->|"image URI"| FE_PRD
    GHA -->|"sourcemaps + version tag"| SentryIO
```

### Environment Matrix

| Environment | Trigger | Approval Gate | Auto-deploy |
|---|---|---|---|
| **HUB** (build) | Push to `main`/`develop`, PR | — | — |
| **Staging** | `workflow_dispatch` or called via `_deploy.yml` | None | Manual / caller-triggered |
| **Production** | Tag `v*.*.*` | GitHub Environment approval | After approval |

> **Note:** `_deploy.yml` is a reusable workflow ready for staging auto-deploy. Wire a `deploy-staging.yml` caller to trigger it automatically on `develop` pushes.

### Image Tagging Strategy

| Event | Tag Format | Example |
|---|---|---|
| Pull Request | `be-pr-{number}-{sha7}` | `be-pr-42-a1b2c3d` |
| Branch push | `be-{branch}-{sha7}` | `be-develop-a1b2c3d` |
| Release tag | `{v1.2.3}` | `v1.2.3` |

### Required Secrets & Variables

| Secret | Scope | Purpose |
|---|---|---|
| `SNYK_TOKEN` | CI | Snyk SCA scan |
| `AWS_OIDC_ROLE` (var) | Build | OIDC role for ECR push |
| `AWS_OIDC_ROLE_STAGING` (var) | Deploy staging | OIDC role for ECS staging |
| `AWS_OIDC_ROLE_PRODUCTION` (var) | Deploy prod | OIDC role for ECS production |
| `SENTRY_AUTH_TOKEN` | Release | Sentry sourcemap upload |

| Variable | Purpose |
|---|---|
| `ECS_CLUSTER_STAGING/PRODUCTION` | ECS cluster name per env |
| `ECS_BACKEND_SERVICE_STAGING/PRODUCTION` | ECS service name |
| `ECS_FRONTEND_SERVICE_STAGING/PRODUCTION` | ECS service name |
| `ECS_BACKEND_TASKDEF_STAGING/PRODUCTION` | Task definition family |
| `ECS_FRONTEND_TASKDEF_STAGING/PRODUCTION` | Task definition family |
| `NEXT_PUBLIC_API_BASE_URL_STAGING/PRODUCTION` | Baked into FE bundle at build time |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Sentry release metadata |

### OIDC Security (GitHub Actions -> AWS)

The platform uses GitHub OIDC federation (`token.actions.githubusercontent.com`) so workflows get short-lived AWS credentials at runtime instead of storing long-lived AWS access keys in GitHub secrets.

**Security properties**
- No static AWS key material in repository settings or CI variables
- Temporary STS credentials are issued only after OIDC token validation
- Blast radius is limited by role scope + session lifetime
- Role assumption can be bound to exact repositories, branches, tags, and environments

**Trust flow**
1. GitHub Actions job requests an OIDC ID token (`id-token: write` permission required).
2. AWS IAM verifies token signature, issuer, audience, and token claims.
3. If IAM trust policy conditions pass, `AssumeRoleWithWebIdentity` returns short-lived credentials.
4. Workflow uses temporary credentials for ECR push / ECS deploy, then credentials expire automatically.

**Recommended IAM trust policy constraints**
- `aud` must equal `sts.amazonaws.com`
- `iss` must equal `https://token.actions.githubusercontent.com`
- `sub` must be restricted to approved refs only, for example:
  - `repo:<org>/<repo>:ref:refs/heads/develop` for staging deploy
  - `repo:<org>/<repo>:ref:refs/tags/v*` for production deploy
- Prefer separate IAM roles per environment (`build`, `staging`, `production`) with least privilege

**Hardening controls**
- Grant only required GitHub workflow permissions; avoid broad defaults
- Protect production deployment with GitHub Environment approval gates
- Enforce branch protection + required status checks before merge
- Keep session duration minimal (for example 15-60 minutes)
- Enable CloudTrail + GuardDuty to monitor anomalous `AssumeRoleWithWebIdentity` usage
- Add explicit deny statements where possible (cross-account, wildcard resources)

**Operational checks**
- Validate role assumption source with CloudTrail `userIdentity.webIdFederationData`
- Alert on OIDC role usage outside expected repositories or refs
- Rotate IAM policies when pipeline scope changes (new services/resources)
- Periodically test break-glass paths and failed-assume scenarios

---

## 5. DevSecOps Pipeline

### Full Pipeline Flow

```mermaid
flowchart TD
    Push["Code Push / PR"] --> CI

    subgraph CI["CI — every PR + push to main/develop"]
        Lint["Lint & Format Check\n(ESLint + Prettier)"]
        Test["Unit Tests\n+ Coverage Report artifact"]
        SCA["SCA Scan\nTrivy FS + Snyk\n→ SARIF → GitHub Security tab"]
        Lint --> Test --> SCA
    end

    CI --> BuildGate{"Event type?"}

    BuildGate -->|"PR only"| PREnd["CI result posted to PR\nNo image built"]

    BuildGate -->|"push to develop/main"| Build

    subgraph Build["Build — BE and FE in separate workflows"]
        BuildBE["Build NestJS image\n./be/Dockerfile\nTrivy container scan inside action"]
        BuildFE["Build Next.js image\n./fe/Dockerfile\nNEXT_PUBLIC_API_BASE_URL baked in\nTrivy container scan inside action"]
    end

    Build --> PushECR["Push to ECR\n{service}-{branch}-{sha7} tag\nSARIF uploaded to GitHub Security"]

    PushECR --> BranchGate{"Branch?"}

    BranchGate -->|"main"| MainEnd["Image available in ECR\nNo auto-deploy"]

    BranchGate -->|"develop"| StagingDeploy

    subgraph StagingDeploy["Deploy — Staging (via _deploy.yml caller)"]
        ECS_STG["Update ECS task definitions\nWait for service stability"]
        DAST["DAST Scan\nOWASP ZAP Baseline\n→ HTML report artifact"]
        PerfTest["Performance Test\nk6 load test\n→ p95 / req count / error rate"]
        ECS_STG --> DAST --> PerfTest
    end

    StagingDeploy --> TagGate{"Release tag\nv*.*.*?"}
    TagGate -->|"no"| Done["Done"]
    TagGate -->|"yes"| ReleaseBuild

    subgraph ReleaseBuild["Release Build — parallel"]
        RBE["Build BE image\ntagged: v1.2.3"]
        RFE["Build FE image\ntagged: v1.2.3\nNEXT_PUBLIC_API_BASE_URL_PRODUCTION baked"]
        Sourcemaps["Build FE sourcemaps\nupload as artifact"]
    end

    ReleaseBuild --> Approval["GitHub Environment Approval Gate\n(production environment)"]
    Approval --> ProdDeploy

    subgraph ProdDeploy["Deploy — Production"]
        ECS_PRD["Update ECS task definitions\nWait for service stability"]
        Sentry["Sentry Release\nUpload sourcemaps + tag version"]
        ECS_PRD --> Sentry
    end

    ProdDeploy --> Done
```

### Security Gates

| Gate | Tool | Stage | Output |
|---|---|---|---|
| Dependency vulnerabilities (FS) | Trivy FS scan | CI — every PR + push | SARIF → GitHub Security tab |
| Dependency vulnerabilities (SCA) | Snyk | CI — every PR + push | Inline report (continue-on-error) |
| Container image vulnerabilities | Trivy image scan | Build — inside `build-push-ecr` | SARIF → GitHub Security tab |
| Runtime DAST | OWASP ZAP Baseline | Post-deploy staging | HTML report artifact (7d retention) |
| Secret scanning | GitHub native | Repository-level | GitHub blocks push |
| Dependency updates | Dependabot | Weekly Monday 09:00 ICT | PRs to `develop` |

> Trivy scans severity: `CRITICAL,HIGH`. All findings visible in GitHub → Security → Code scanning.

### Performance Testing

k6 runs automatically after every staging deploy via `_deploy.yml`.

```
fe/k6/load-test.js         ← test script
TARGET_URL                 ← staging app URL
K6_CLOUD_TOKEN             ← optional: upload to Grafana Cloud k6
```

**Metrics reported in GitHub Step Summary:**

| Metric | Description |
|---|---|
| `p95 latency` | 95th percentile HTTP response time (ms) |
| `Total requests` | Total requests fired during test |
| `Error rate` | Percentage of failed requests (%) |

Results artifacts: `k6-results.json` + `k6-summary.json` (7d retention).

### Dependency Management

Dependabot runs **every Monday 09:00 ICT**, targets `develop` branch.

| Ecosystem | Directory | Grouping | PR limit |
|---|---|---|---|
| npm | `/be` | All minor + patch grouped as `backend-non-major` | 5 |
| npm | `/fe` | All minor + patch grouped as `frontend-non-major` | 5 |
| github-actions | `/` | Individual (no grouping) | 3 |

Major version bumps always get individual PRs regardless of grouping.

---

## 6. Observability Stack

### Signal Architecture

```mermaid
graph LR
    subgraph Apps["Applications"]
        BE_App["NestJS Backend\nOTEL NodeSDK\nauto-instrumented\n(HTTP, Express, DB)"]
        FE_App["Next.js Frontend\nOTEL SDK"]
    end

    subgraph Tracing
        Jaeger["Jaeger All-in-One\nOTLP gRPC :4317\nOTLP HTTP :4318\nUI :16686"]
    end

    subgraph Metrics
        Prom["Prometheus :9090\nScrapes /metrics\n15s interval"]
        Graf["Grafana :3002\nDashboards\nadmin / admin"]
    end

    subgraph Logs
        FBit["Fluent Bit\nReads /var/lib/docker/containers\nParses JSON logs"]
        ES["Elasticsearch :9200\nsingle-node\n512MB heap"]
        Kib["Kibana :5601"]
    end

    BE_App -->|"OTLP HTTP\n/v1/traces"| Jaeger
    FE_App -->|"OTLP"| Jaeger
    BE_App -->|"GET /metrics\nprom-client"| Prom
    Prom --> Graf
    Jaeger -->|"Grafana data source"| Graf
    FBit -->|"parsed container logs"| ES
    ES --> Kib
```

### Stack Components

| Component | Image | Port(s) | Purpose |
|---|---|---|---|
| Jaeger | `jaegertracing/all-in-one:1.59` | 16686 (UI), 4317 (gRPC), 4318 (HTTP) | Distributed tracing |
| Prometheus | `prom/prometheus:v2.55.1` | 9090 | Metrics scraping + storage |
| Grafana | `grafana/grafana:11.2.0` | 3002 | Unified dashboards (metrics + traces) |
| Elasticsearch | `elasticsearch:8.15.0` | 9200 | Log storage and indexing (security off) |
| Kibana | `kibana:8.15.0` | 5601 | Log search and visualization |
| Fluent Bit | `fluent/fluent-bit:3.1.9` | — | Collect + parse Docker container logs |

### Backend Metrics Exposed

Custom Prometheus metrics (`internship_management_` prefix):

| Metric | Type | Labels | Description |
|---|---|---|---|
| `internship_management_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | HTTP request latency |
| Default Node.js metrics | Various | — | CPU, memory, event loop, GC |

Histogram buckets: `0.005s, 0.01s, 0.05s, 0.1s, 0.3s, 1s, 2s, 5s`

### Environment Variables for Observability

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_ENABLED` | `true` | Set `false` to disable tracing |
| `OTEL_SERVICE_NAME` | `internship-management-be` | Service name in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector base URL |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | derived from above | Override traces endpoint only |

### Local Development

Start full stack with observability:

```bash
docker compose up -d
```

| UI | URL | Credentials |
|---|---|---|
| Application frontend | http://localhost:3000 | — |
| Backend API + Swagger | http://localhost:3001/api/docs | — |
| Jaeger traces | http://localhost:16686 | — |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3002 | admin / admin |
| Kibana logs | http://localhost:5601 | — |
