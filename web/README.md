# FinAdviser web app

A UK/GBP household finance workspace built with Next.js, a double-entry ledger, Neon Postgres and decimal currency calculations.

## Finance workflows

- **Financial plan** (`/plan`): recorded household cash flow, an explained action queue, emergency-fund assumptions, investments and property exposure. Planning assumptions are saved in `app_settings` under `planning.profile.v1`.
- **Spending** (`/spending`): six completed calendar months, a recent-versus-prior three-month comparison, category and merchant search, recurring-payment candidates and a user-selected spending reduction that can become a category budget.
- **Savings goals** (`/goals`): create targets, record allocations, plan monthly contributions and review completed or cancelled goals. Recorded allocations do not move money or add to net worth.
- **Pensions** (`/pensions`): a personal defined-contribution scenario with editable contribution, employer contribution, growth, fee, inflation, retirement-income and State Pension assumptions. Choose which tracked pots belong to your scenario. A household total is not automatically your personal pension.
- **Properties and investments**: existing ownership, rent, mortgage, valuation and tax-report workflows connect to the plan. Property cash-flow summaries are observed ledger averages, not contractual rent or after-tax profit.
- **AI Chat**: the adviser reads the same deterministic financial plan and explains its evidence and missing data. Live model access needs an AI Gateway key.

Without a database, the plan offers an explicitly fictional example which never writes to the ledger. Missing data remains unknown; an unavailable connection is not displayed as a zero balance. Pension calculations can run without storage, but saving assumptions needs the database.

See [the product review and research notes](../docs/personal-finance-research.md) for the evidence, source-access limitations and remaining roadmap. Projection ranges are editable illustrations, not probabilities or guaranteed returns. The app does not yet track individual investment holdings, defined-benefit pension promises or verified current allowance usage.

## Getting Started

Requires Node >=20.19. Install dependencies and start development:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Copy `.env.example` to an ignored local environment file or supply its variables through environment settings. Never commit real credentials. `DATABASE_URL` must point to an accessible development Neon database; the app uses Neon's HTTP driver, so an ordinary local PostgreSQL server is not a drop-in app connection. `AI_GATEWAY_API_KEY` is optional for deterministic planning. Production requires both `APP_PASSWORD` and `SESSION_SECRET` and fails closed without them.

`npm run db:migrate` applies `src/lib/db/migration.sql` atomically using Neon WebSockets. It assumes the base ledger tables already exist. Verify the base schema before applying it to an empty database. The migration also runs during `npm run build` when `DATABASE_URL` is set; an unconfigured build explicitly skips database migration. Apply the migration before using the updated investment balance setter. Do not use the personal sample-data seed as database setup.

Inter and Instrument Serif are bundled locally with their licenses. Development and production builds do not fetch Google Fonts.

## Validation

```bash
npm test -- --maxWorkers=3
npx tsc --noEmit
npm run lint
npm run build
```

Real PostgreSQL regression tests are opt-in through `DATA_PLAN_TEST_PG_URL`, which must point to a disposable test database. They use isolated fixtures and exercise actual SQL for planning, signed balances, budgets and date cutoffs. This variable is separate from the app's Neon `DATABASE_URL`. Without it, those checks are reported as skipped. Browser checks performed during this improvement pass covered unavailable data, the fictional plan, profile and budget request contracts, pension scenarios, goal create/edit/status flows, save failures and 390px mobile layouts; intercepted writes were synthetic, not live financial records.

## Data-plan loader

`scripts/apply-data-plan.ts` loads a reviewed JSON "data plan" (tenancies, journals, letting type, owner tax profile) into the database. It only ever INSERTs and UPDATEs, is idempotent, and its dry run is read-only. The plan format is `src/lib/data-plan/schema.ts`; `scripts/data-plan.example.json` is a made-up template (keep real plans outside the repo: `*.plan.json` is git-ignored).

```bash
export DATABASE_URL=postgres://...
npm run data-plan:check -- --plan plan.json --snapshot              # what the database holds now
npm run data-plan:check -- --plan plan.json --account alias="Exact Name"   # dry run: prints a change digest
npm run data-plan:apply -- --plan plan.json --account alias="Exact Name" --expect-digest <digest>
```

Before the latest migration has run (`npm run db:migrate`, or the next deploy), the dry run still works: it says "schema not migrated yet", lists the letting-type and tax-profile items as "pending migration" and plans everything else. `--apply` refuses until the schema is present.

**From a sandbox that only reaches the internet through an HTTPS CONNECT proxy** (no WebSocket upgrades), use the HTTP driver. It speaks plain HTTPS on port 443, through `HTTPS_PROXY`, and trusts the proxy's CA via `NODE_EXTRA_CA_CERTS`:

```bash
npm run data-plan:check -- --driver http --plan plan.json --account alias="Exact Name"
npm run data-plan:apply -- --driver http --plan plan.json --account alias="Exact Name" --expect-digest <digest from the dry run>
```

`DATA_PLAN_DRIVER=http` does the same as `--driver http`. In this mode `--expect-digest` is required: apply sends all its writes as one atomic batch, every write guards itself in SQL, and a final check rolls the whole batch back if anything changed since the read (see the header of `src/lib/data-plan/http-statements.ts`).

Exit codes: 0 ok, 1 unexpected error (or a failed post-commit check), 2 refused, 3 not ready to apply (dry run), 4 bad usage or invalid plan.
