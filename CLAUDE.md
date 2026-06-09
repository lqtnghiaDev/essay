# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a monorepo with two independent applications:
- `be/` — NestJS backend (API + WebSocket + AI/RAG)
- `fe/` — Next.js frontend (App Router)

---

## Backend (`be/`)

### Commands

```bash
cd be
npm run start:dev     # Development with hot reload
npm run build         # Compile TypeScript → dist/
npm run start:prod    # Run production build
npm run test          # Unit tests (Jest)
npm run test:e2e      # End-to-end tests
npm run test:cov      # Coverage report
npm run lint          # ESLint with auto-fix
npm run format        # Prettier format
```

### Architecture

NestJS modular architecture. Key modules in `src/`:

| Module | Responsibility |
|--------|---------------|
| `auth/` | JWT authentication, Passport strategies, guards |
| `users/` | User CRUD; roles: `admin`, `mentor`, `intern` |
| `assignments/` | Links training plans + tasks + interns |
| `training-plans/` | Skill-based training program templates |
| `tasks/` | Task definitions |
| `attendance/` | Intern attendance tracking |
| `chat/` | Chat sessions and messages |
| `llm/` | Gemini API integration |
| `rag/` | Retrieval-Augmented Generation pipeline (ChromaDB + embeddings) |
| `notifications/` | Real-time notifications via Socket.IO |
| `dashboard/` | Analytics aggregation |
| `reports/` | Report generation |

**Entry point**: `src/main.ts`, default port `3000` (override with `PORT` env var).

**Swagger docs**: available at `/api/docs` in development.

**RAG pipeline**: documents are extracted (Puppeteer), embedded (OpenAI or Gemini), stored in ChromaDB, and retrieved with role-based filtering for AI chat context.

### Environment Variables

Backend requires a `.env` file with at minimum:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET`
- `GEMINI_API_KEY`
- `CHROMA_URL` / `CHROMA_HOST` — ChromaDB vector store
- `PORT` (optional, defaults to 3000)

---

## Frontend (`fe/`)

### Commands

```bash
cd fe
npm run dev       # Dev server at localhost:3000
npm run build     # Production bundle
npm run start     # Serve production build
npm run lint      # ESLint
```

### Architecture

Next.js App Router with route-group-based role isolation:

```
src/app/
├── (auth)/login/               # Public login page
├── (protected)/
│   ├── (admin-only)/           # Admin dashboard & user management
│   ├── (mentor-only)/          # Mentor views & reports
│   ├── (intern-only)/          # Intern dashboard & task views
│   └── (shared)/               # Assignments, chat, skills, tasks, training plans
├── error/access-denied/
└── export/                     # PDF/report export
```

**Auth flow** (`src/components/providers/`):
- `AuthProvider` wraps the whole app; redirects unauthenticated users to `/login`
- `RoleGuard` enforces per-route role access; unauthorized → `/error/access-denied`
- Authenticated users on `/` are redirected to their role-specific dashboard

**State management**: Zustand stores in `src/store/` (auth state, notifications, UI state).

**Data fetching**: SWR (`swr`) for server data; fetch-based service layer in `src/services/` sends `Authorization: Bearer {token}` headers.

**API base URL**: defined in `src/constants/` as `API_URL`.

**Real-time**: `socket.io-client` connects to backend for live notifications.

**UI stack**: TailwindCSS + Radix UI primitives (wrapped in `src/components/ui/`) + Framer Motion for animations. Dark mode via `darkMode: "class"`.

---

## Key Cross-Cutting Patterns

- **TypeScript strict mode** in both apps.
- **Role-based access** enforced at both layers: NestJS guards (backend) and route groups + `RoleGuard` (frontend).
- **Response envelope**: backend wraps all responses in `ResponseBase<T>`; frontend services unwrap accordingly.
- **CORS**: backend allows `localhost:3000/3001/3002` and configured Vercel deployment URL.
- **Database**: PostgreSQL via TypeORM; entities live alongside their module in `be/src/<module>/entities/`.