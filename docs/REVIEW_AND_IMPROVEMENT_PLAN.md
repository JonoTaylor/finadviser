# finadviser — Review & Improvement Plan

_Last updated: 2026-04-17_

This document captures the results of a full-stack audit of the `finadviser`
codebase and proposes a prioritized plan to address the findings. It covers the
Python TUI backend (`finadviser/`), the Next.js web API + frontend (`web/`),
the shared data layer, and the test/deployment story.

---

## 1. Current State Summary

**Stack**
- Python 3.9+ Textual TUI with a SQLite database (`finadviser/`)
- Next.js 16 (React + Material-UI + Decimal.js) with Drizzle ORM on Postgres
  (Neon HTTP driver) (`web/`)
- Anthropic Claude for the adviser conversation layer
- CSV-based transaction import with bank-specific config

**High-level observations**
- Two parallel backends (Python TUI and Next.js API) implement overlapping
  logic (CSV parsing, bank config, categorisation, fingerprinting). The TUI
  appears to be the prototype; the web stack is where new work is landing.
- The web API has **no authentication, authorisation, input validation,
  rate limiting or CORS policy**. Any caller on the internet can read, mutate
  or wipe data.
- The SQLite schema stores monetary amounts as `REAL`, which introduces
  floating-point rounding errors for financial data. The Postgres schema
  correctly uses `numeric(14,2)`.
- Tests cover the Python package only; the web API and UI have no automated
  coverage.
- No CI, no migrations tracking, no deployment manifests.

---

## 2. Findings by Severity

### 2.1 Critical

| # | Area | Location | Issue |
|---|------|----------|-------|
| C1 | AuthN/AuthZ | `web/src/app/api/**` | All API routes are unauthenticated. No middleware, session or API-key check. |
| C2 | Destructive endpoint | `web/src/app/api/seed/route.ts:4` | `POST /api/seed` wipes and reseeds the DB without any guard. Callable by anyone in any environment. |
| C3 | Secret handling | `web/src/lib/ai/claude-client.ts:12`, `web/drizzle.config.ts:6` | `process.env.X!` non-null assertions crash silently when env is missing and give no operator feedback. |
| C4 | Financial precision | `finadviser/db/schema.py:52` | `amount REAL NOT NULL` — floating-point for money causes cumulative rounding drift across reports. |

### 2.2 High

| # | Area | Location | Issue |
|---|------|----------|-------|
| H1 | Input validation | `web/src/app/api/journal/route.ts:10-14` | `parseInt` on query strings with no bounds; `limit`/`offset` unchecked (OOM/abuse risk). |
| H2 | Input validation | `web/src/app/api/properties/route.ts:14-16` | Request body is passed straight to the repository with no schema validation. |
| H3 | CORS & rate limits | `web/` | No CORS config, no rate limiting, no request-size limits. |
| H4 | Error visibility | all API routes | Generic `500 { error: '...' }` with swallowed stack traces and no server-side structured logging. |
| H5 | ReDoS | `finadviser/importing/categorizer.py` via `match_type='regex'` (`finadviser/db/schema.py:30`) | User-supplied regex patterns run on every import row with no validation or timeout. |
| H6 | Silent data loss | `finadviser/importing/csv_parser.py:31-37` | Malformed CSV rows are skipped under `except (ValueError, KeyError, InvalidOperation)` with no logging or count. |
| H7 | N+1 query | `finadviser/analysis/data_preparer.py:126-138` | `get_mortgage_balance` called inside a loop over mortgages. |
| H8 | Sync I/O in async handler | CSV parsing uses `pandas.read_csv` on request threads; blocks the Next.js worker for large files. |

### 2.3 Medium

| # | Area | Location | Issue |
|---|------|----------|-------|
| M1 | Duplicated logic | `finadviser/importing/*` vs `web/src/lib/import/*` | CSV parser, bank config loader, categorizer and fingerprint hashing exist in both Python and TypeScript. Divergence risk. |
| M2 | Magic strings | across both backends | `standard`/`inverted`, `contains`/`startswith`/`exact`/`regex`, `Uncategorized*` repeated verbatim — should be enums/constants. |
| M3 | Hard-coded model | `web/src/lib/ai/claude-client.ts:5` | Claude model ID baked into source; should be config-driven. |
| M4 | Unbounded LLM context | `finadviser/analysis/data_preparer.py:29-55` | Concatenates all spending/transactions/properties into the prompt; cost + latency + leak surface all grow unbounded. |
| M5 | Missing cascades | `finadviser/db/schema.py` | Foreign keys enabled but `ON DELETE` policies inconsistent; orphan risk. |
| M6 | Caching | expensive reads (category list, property valuations) are recomputed every request. |
| M7 | DB driver choice | `web/src/lib/db/index.ts:7-16` | Singleton Neon HTTP client is fine on serverless but will bottleneck on long-lived runtimes. Document intended deploy target. |

### 2.4 Low

| # | Area | Notes |
|---|------|-------|
| L1 | Test coverage | Python tests ~900 lines; web API and React components have no tests. |
| L2 | Fixtures | Tests reference `tests/fixtures/sample_transactions.csv` and `sample_bank_config.yaml`; pin/commit these. |
| L3 | Docs | No README for running both backends, no ADRs, no deployment doc, no OpenAPI spec. |
| L4 | CI/CD | No GitHub Actions, no lint/type/test gate, no Drizzle migration tracking. |
| L5 | Observability | No structured logs, metrics or error tracking (Sentry, OTel). |
| L6 | Backups / retention | No documented backup, export or retention policy. |
| L7 | Accessibility | MUI defaults are reasonable but no audit has been done — keyboard nav, contrast, ARIA on charts. |

---

## 3. Improvement Plan

The plan is organised as four themed phases. Each item lists the change, the
files it touches and a rough effort estimate (S: <1 day, M: 1–3 days, L: 1
week+).

### Phase 1 — Stop the bleeding (Week 1)

Goal: make the deployed API safe to expose.

1. **Add authentication middleware** (C1) — `web/src/middleware.ts` + a JWT or
   session check in every `/api/*` handler. Pick one of: Auth.js (NextAuth),
   Clerk, or a signed-cookie scheme. **Effort: M.**
2. **Gate the seed endpoint** (C2) — refuse unless `NODE_ENV !== 'production'`
   **and** a signed admin token is present. Better: delete it and ship seeds
   via a CLI script. **Effort: S.**
3. **Validate env at boot** (C3) — introduce `web/src/lib/env.ts` using Zod;
   parse `process.env` once and export typed config. Replace all `!`
   assertions. **Effort: S.**
4. **Zod-validate every request body and query** (H1, H2) — introduce
   `web/src/lib/validation/` with one schema per route; wrap handlers in a
   `withValidation()` helper that returns 400 on parse error. **Effort: M.**
5. **Add CORS + rate limiting + body-size limits** (H3) — Next.js middleware
   with an allowlist of origins and `@upstash/ratelimit` (or equivalent) keyed
   by IP + user. **Effort: S.**
6. **Structured error handling** (H4) — central `apiHandler()` wrapper that
   logs errors server-side (pino), returns a safe client message, and tags a
   correlation id on the response. **Effort: S.**

Exit criteria: an unauthenticated request to any `/api/*` route returns 401;
all inputs are validated; `seed` is gone or guarded; an error in a handler
produces a structured log line and a safe JSON response.

### Phase 2 — Fix the data model (Weeks 2–3)

Goal: make financial data trustworthy and importable without surprises.

7. **Fix money precision** (C4) — migrate SQLite `amount REAL` → store integer
   cents or use a `TEXT` + `Decimal` pattern; or retire the SQLite backend
   entirely (see item 15). Update `finadviser/db/schema.py:52`, the repos that
   read/write `amount`, and backfill existing rows. **Effort: M.**
8. **Safe regex matching** (H5) — validate patterns at rule-creation time,
   compile with a size limit, execute with a timeout (e.g. `re2` via
   `google-re2` or a worker with SIGALRM). **Effort: S.**
9. **Surface import errors** (H6) — `csv_parser.py` should return `(rows,
   skipped[])` with the line number + reason for each skip, and the UI should
   display that summary after preview. **Effort: S.**
10. **Kill the N+1** (H7) — add `get_mortgage_balances([ids])` and call it
    once in `data_preparer.py`. **Effort: S.**
11. **Offload CSV parsing** (H8) — in the web API, stream the file and parse
    with `papaparse` in a worker, or accept the upload, return a job id, and
    process asynchronously. **Effort: M.**
12. **FK cascades + timestamps** (M5) — audit every foreign key and set
    explicit `ON DELETE`. Allow `created_at` override for historical imports.
    **Effort: S.**

Exit criteria: round-trip import of a real statement produces zero rounding
drift, skipped rows are visible, and importing a 10k-row file does not block
the event loop.

### Phase 3 — Consolidate & harden (Month 2)

Goal: remove duplication, raise the test floor, add CI.

13. **Pick one backend** (M1) — decide: keep Python TUI as a dev tool but move
    all import/categorisation logic into the Next.js app (or vice versa).
    Delete the losing copy. This is the single biggest maintainability win.
    **Effort: L.**
14. **Shared constants / enums** (M2) — one module for sign convention, match
    type, special category names. Generated from a single source if both
    backends survive. **Effort: S.**
15. **Config-driven model selection** (M3) — move Claude model id + max
    tokens to env + `claude-client.ts` reads from config. **Effort: S.**
16. **Bound the LLM context** (M4) — cap transactions, paginate, and add a
    summariser step for older months before they hit the prompt. Track input
    token counts per request. **Effort: M.**
17. **Caching** (M6) — `unstable_cache` or a Redis layer for category lists,
    property valuations and derived summaries with explicit invalidation on
    write. **Effort: M.**
18. **Write tests** (L1) — target ≥70% coverage on the web API: Vitest +
    supertest-style route tests, React Testing Library for critical UI. Add a
    Playwright smoke test for the golden path (upload → preview → commit →
    chat). **Effort: L.**
19. **Add CI** (L4) — GitHub Actions workflow running lint (ruff + eslint),
    typecheck (mypy + tsc), tests (pytest + vitest), and Drizzle migration
    diff check on every PR. **Effort: M.**
20. **Track Drizzle migrations** (L4) — commit `drizzle/meta` + migrations;
    make `drizzle-kit generate` a CI requirement. **Effort: S.**

Exit criteria: PRs are gated on green CI; coverage ≥70% on new code; only one
implementation of each import primitive exists.

### Phase 4 — Operational polish (Month 3+)

21. **Observability** (L5) — Sentry for exceptions, pino → log aggregator,
    basic RED metrics (rate/errors/duration) per route.
22. **Backups + retention** (L6) — document Neon branching/PITR; export job
    for offline backup; define retention windows per table.
23. **OpenAPI spec** (L3) — generate from Zod schemas (e.g. `zod-to-openapi`)
    and publish at `/api/docs`.
24. **Accessibility pass** (L7) — axe-core audit, keyboard-navigable charts,
    colour-contrast check, focus management in dialogs.
25. **Audit log** — append-only `audit_events` table capturing who changed
    what for every mutation.

---

## 4. Recommended Immediate Next Steps

If only three things happen this week, do these:

1. **Ship Phase 1 items 1–3** (auth, gate seed, validate env). The API is
   currently unsafe to deploy.
2. **Add Zod validation + error wrapper** (Phase 1 items 4, 6). Everything
   else is cheaper once handlers are consistent.
3. **Decide the backend consolidation question** (Phase 3 item 13). Every
   week spent maintaining two parallel stacks makes the eventual merge harder.

---

## 5. Open Questions for the Team

- Who are the intended users — single-tenant (Emily) or multi-tenant? That
  answer drives the auth model and changes the database schema (owner scoping
  on every table).
- Is the Python TUI still a target deliverable, or can it be retired?
- What is the deployment target — Vercel + Neon, or a self-hosted Postgres?
  This affects the DB client choice (Neon HTTP vs pg pool).
- What is the data retention / export expectation? Regulatory scope (GDPR,
  financial advice licensing) should be confirmed before go-live.

---

_Prepared as part of the `claude/app-review-plan-7bA7C` branch. File paths and
line numbers reflect the state of `main` at the time of writing; re-verify
before acting on individual items._
