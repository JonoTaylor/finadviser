# FinAdviser phase two: Jono's financial operating system

Plan date: 11 October 2026. This is a delivery plan, not evidence that every item is implemented or live. Record actual PR links, commits, tests and deployment checks in the release record as they become available.

## Personalisation grounded in evidence

Confirmed in this session: the user is Jono; he wants to manage spending, investments, properties and pensions in one app; he first prioritised reducing spending and building wealth, then explicitly requested all areas; he authorised planning the next phase, creating PRs and rolling the upgrades out. The existing app uses UK/GBP conventions. That is a product default, not confirmation of Jono's tax residence or eligibility.

Not verified: age, retirement age, income, expenditure, holdings, debts, employment, employer pension terms, partner or dependants, property ownership shares, selected ledger owner, tax residence or UK tax region, risk capacity, investment experience, benefits, State Pension entitlement, or current live banking/model configuration. Leave these unknown until Jono supplies them or selects recorded evidence. Do not infer an owner from alphabetical order or assume a household balance belongs entirely to Jono.

Success means accurate and reproducible figures, understandable next steps, progress towards Jono's priorities and less administration. "Best personal finance app" is the ambition; release notes must describe delivered behaviour and its measured evidence.

## Shared architecture

- Preserve the existing `planning.profile.v1` schema and clients in this phase. Personal context, debt metadata, holding snapshots, property obligations, pension records and review state use separate versioned namespaces.
- A shared server-side workspace store uses `app_settings`, strict dataset schemas and revisioned read/write envelopes. Conditional writes detect stale revisions; conflicts preserve the newer record and ask the client to reload before applying changes. Storage failure remains distinct from an empty dataset.
- Keep financial calculations in deterministic Decimal modules. The UI and AI read the same results, scope, dates and limitations. Free-form notes and imported descriptions are reference data, never assistant instructions.
- Ledger balances remain the financial source of truth. Linked debt metadata, investment holding decompositions, goal allocations, DB pension promises and review snapshots must not create additional ledger assets or liabilities.
- A portable, versioned workspace export can include the new datasets and assumptions. Label its scope explicitly. The existing ledger export is capped and incomplete; neither export is a full backup or restore guarantee.

## Six cohesive PRs

| Order and proposed branch | Reviewer-facing change | Dependencies and acceptance |
| --- | --- | --- |
| **PR1 — `upgrade/personal-context`** | Add the common revisioned workspace store and a personal context workspace. Capture preferred name, explicit ledger-owner selection, priorities and optional suitability facts. Explain recorded versus unknown context and household versus personal scope. | Independent foundation. Validate strict payloads, unknown values, inaccessible storage, concurrent writes and owner selection. Existing plan/profile/pension clients continue working. Context does not invent age, income or tax region, and selecting an owner does not silently attribute shared holdings. |
| **PR2 — `upgrade/debt-planning`** | Add debt records and an editable repayment workspace. Link records to existing liabilities; capture APR, minimum payment, priority/arrears status, promotional dates and repayment restrictions. Compare avalanche and snowball strategies using an explicitly entered monthly payment budget. | Shared store from PR1. Decimal tests cover zero APR, capped final payment, insufficient minimum-payment budget, negative amortisation, payoff bounds and changing promotional rates where supported. Unknown terms prevent precise claims. Do not add a linked liability twice or post simulated payments to the ledger. Priority commitments remain visible ahead of optimisation. |
| **PR3 — `upgrade/investment-holdings`** | Add dated holding/allocation snapshots under existing investment accounts, separating wrapper from underlying asset class. Show recorded allocation, unclassified remainder, concentration, user-entered charges and statement freshness. | Shared store from PR1; ledger investment balances stay authoritative. Check reconciliation, over-allocation, unknown fees, stale snapshots and empty records. Fees are explicit estimates; holdings are decomposition data, not another net-worth balance. Initial GBP-only values must be labelled; do not fabricate FX rates or live prices. |
| **PR4 — `upgrade/property-operations`** | Add a property operations centre combining tenancy schedules, observed property income, upcoming tenancy changes, reserve inputs and user-recorded obligations with dates/status. Link to existing tenancy, mortgage and expense workflows. | Shared store from PR1 and existing rent-schedule/tenancy repositories. Test month-end rent dates, weekly/four-weekly schedules, handover days, overlapping tenancies, signed refunds and absent receipts. Scheduled-minus-observed income is an **unreconciled rent gap**, not verified tenant arrears. Obligation dates are user records, not automatic legal compliance certification. |
| **PR5 — `upgrade/pension-records`** | Add a personal pension inventory distinguishing DC pots, DB promised annual income and a user-supplied State Pension forecast. Record provider, effective dates, personal/employer contributions, charges and benefit start ages; connect selected records to the existing scenario workflow. | Shared store/context from PR1; preserve saved legacy scenarios. Test explicit personal selection, multiple owners, incomplete records and date handling. DB promises never become guessed capital. Household DC totals never automatically become Jono's pot. Do not invent employer matching, tax relief or State Pension entitlement, or count selected contributions twice. |
| **PR6 — `upgrade/adviser-reviews`** | Connect verified context and the new evidence to the adviser. Add a persistent action workflow and periodic financial reviews, with evidence snapshots, notes and comparisons for spending, goals, reserves and debts. Export the explicitly scoped workspace data. | Integrates PRs1–5. Check action transitions, changed evidence, missing-data states, repeat reviews, revision conflicts and AI prompt boundaries. Marking an action complete does not imply its financial condition is resolved. Recurring-payment candidates and intended reductions are not confirmed subscriptions or realised savings. No unsupported individual-security, legal or current-tax-rule claims. |

## Branching and release order

Use the proposed branches as independently reviewable slices. PR1 targets `main`. Branches for PRs2–5 can be prepared in parallel once their shared-store contract is agreed, then rebase onto PR1 after it lands and target `main`. PR6 lands last after all feature contracts are available. If a temporary stacked PR is necessary, identify its parent branch and retarget it to `main` after the parent merges; do not leave a PR targeting an obsolete integration branch.

Each PR description leads with the user-visible problem and resulting behaviour, followed by relevant calculation, persistence and browser evidence. GitHub access is now available and the actual PRs are recorded below. Remote deployment HTTP access remains blocked, so Vercel states are checked through GitHub's deployment records. A deployment status is distinct from live database, banking and model acceptance.

Merge and roll out in the table's order, keeping each slice deployable. PRs2–5 do not need to wait for one another's feature implementation, but every merged slice needs its own checks. Review the complete diff before publishing. Changes to any live financial records must remain in Jono's explicit app workflows; rollout must not seed example finances into production.

## Acceptance and truthful production checks

1. Run focused calculation and API checks per PR. Exercise real PostgreSQL persistence for the revisioned store, conditional writes and any newly introduced SQL. Run TypeScript and lint; finish with the full suite and production build after integration.
2. Verify actual desktop and 390px mobile workflows: blank/missing data, realistic synthetic records, invalid inputs, save failure, revision conflict and persisted reload. Clearly identify intercepted requests as synthetic tests, not a live database check.
3. Check changes against existing plan, investment-balance, budget, savings-goal, property and pension workflows. Preserve legacy profile compatibility and signed refund/transfer/date-cutoff behaviour.
4. Record the actual published commit, deployment URL and Vercel state. A successful build or a user-reported **Ready** deployment is not proof that live database persistence, banking sync or AI calls work.
5. Where access permits, verify the deployed new routes, authentication, real read/save/reload behaviour and an authorised live adviser read against the configured services. Use non-sensitive acceptance records and reversible changes. Do not expose credentials or private financial data in logs or release notes.
6. If Vercel or database inspection remains blocked, state exactly which checks passed locally, which remote operation returned HTTP 403 and which production checks remain unverified. Do not claim live service readiness from local mocks.

## Follow-on work after this phase

Full ledger portability and tested restore; explicit rent receipt allocation; verified and dated regional property-compliance rules; current tax-source updates; broader pension drawdown modelling; banking reconnection/recovery; accessibility and performance acceptance; monitoring and backup exercises. These remain separately scoped work until the actual records, rules and production evidence support their implementation.

## Release evidence on 11 October 2026

| Upgrade | Actual PR | Merged production commit and deployment |
| --- | --- | --- |
| Personal context and workspace storage | [#63](https://github.com/JonoTaylor/finadviser/pull/63) | `524d9ef` · [Vercel production](https://finadviser-gyv6gobw5-jonotaylors-projects.vercel.app) · successful deployment status |
| Debt records and repayment comparisons | [#64](https://github.com/JonoTaylor/finadviser/pull/64) | `d23af58` · [Vercel production](https://finadviser-7s5mpssvs-jonotaylors-projects.vercel.app) · successful deployment status |
| Holdings, allocation and known fees | [#65](https://github.com/JonoTaylor/finadviser/pull/65) | `92c0602` · [Vercel production](https://finadviser-ej500s5np-jonotaylors-projects.vercel.app) · successful deployment status |
| Property rent reconciliation and obligations | [#66](https://github.com/JonoTaylor/finadviser/pull/66) | `fd2b93a` · [Vercel production](https://finadviser-rn2v4ttho-jonotaylors-projects.vercel.app) · successful deployment status |
| DC, DB and State Pension inventory | [#67](https://github.com/JonoTaylor/finadviser/pull/67) | `c9f1c6b` · [Vercel production](https://finadviser-h987bja7g-jonotaylors-projects.vercel.app) · successful deployment status |
| Adviser integration, saved actions, reviews and planning export | [#68](https://github.com/JonoTaylor/finadviser/pull/68) | This document accompanies that release; consult its GitHub/Vercel deployment record for the final published commit and state. |

Every code slice was validated in an isolated checkout before merging. Full suite counts progressed through 734, 793, 835, 876 and 923 tests; the integrated sixth release passed **1,005 tests in 85 files**, including the enabled disposable PostgreSQL integration fixtures with no skipped tests. Its production build and TypeScript check passed. ESLint reported zero errors and 41 existing warnings.

Independent review corrected a repayment forecast that stopped during temporary balance growth, portfolio fee aggregation rounding, pension-calculator wording and spending-action category fingerprint collisions. Desktop and 390px browser checks covered explicit owner selection, unavailable storage, CRUD, invalid inputs, save failures, stale revisions, preserved notes, server-only snapshot metrics, exports and mobile navigation. Intercepted persistence requests were synthetic; no example records were written to production.

Direct deployment HTTP checks remain blocked by the environment proxy. Live database read/save/reload, bank synchronisation and adviser provider calls remain unverified. No new schema migration is required for these workspaces; the existing `app_settings` store is reused. Unknown personal facts remain inputs for Jono to confirm in My context.
