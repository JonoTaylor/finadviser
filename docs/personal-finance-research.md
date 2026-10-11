# FinAdviser product review and research notes

Review date: 11 October 2026. Scope: the Next.js web application on the existing checkout. This is a source-code review, not an audit of the user's balances or a production security assessment.

## Evidence and research status

The source review below was performed directly. Public finance-source retrieval was attempted with TLS verification enabled. The environment proxy refused the HTTPS CONNECT requests to the live guidance sites with HTTP 403, so **none of the guidance pages in the following table was read in this research pass**. The first sandbox request could not reach the proxy; approved read-only requests outside that sandbox reached the proxy but were denied. Do not describe these links as verified current guidance, quotations, or evidence that a particular tax allowance applies in 2026–27. Two public finance-tool repositories on accessible GitHub were retrieved directly, as recorded separately below.

| Authority and intended topic | Official source pointer | Retrieval on 11 October 2026 |
| --- | --- | --- |
| MoneyHelper: budgeting | https://www.moneyhelper.org.uk/en/everyday-money/budgeting/beginners-guide-to-managing-your-money | Blocked by proxy, HTTP 403 |
| MoneyHelper: emergency savings | https://www.moneyhelper.org.uk/en/savings/types-of-savings/emergency-savings-how-much-is-enough | Blocked by proxy, HTTP 403 |
| GOV.UK: ISA eligibility and subscription rules | https://www.gov.uk/individual-savings-accounts | Blocked by proxy, HTTP 403 |
| GOV.UK: pension tax relief | https://www.gov.uk/tax-on-your-private-pension/pension-tax-relief | Blocked by proxy, HTTP 403 |
| GOV.UK: rental-income tax | https://www.gov.uk/renting-out-a-property/paying-tax | Blocked by proxy, HTTP 403 |
| FCA InvestSmart: investment decision questions | https://www.fca.org.uk/investsmart/five-questions-ask-you-invest | Blocked by proxy, HTTP 403 |
| PLSA: Retirement Living Standards | https://www.retirementlivingstandards.org.uk/ | Blocked by proxy, HTTP 403 |

Further official references to investigate, not retrieved here: [State Pension forecast](https://www.gov.uk/check-state-pension), [Pension Tracing Service](https://www.gov.uk/find-pension-contact-details), [FCA Financial Services Register](https://register.fca.org.uk/), and [HMRC residential-landlord finance-cost guidance](https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies).

The next research pass needs network access to `www.moneyhelper.org.uk`, `www.gov.uk`, `www.fca.org.uk`, and `www.retirementlivingstandards.org.uk` (including any official redirect destinations). Preserve the existing allowlist when adding destinations. Record the actual document publication/update date, retrieved date, jurisdiction, tax year, and announced-versus-enacted status. Existing repository comments about earlier search-result extracts are repository assertions, not independent verification in this pass.

### Retrieved primary technical publications

These sources were fetched directly from their public GitHub repositories on 11 October 2026; no unofficial mirror, external forwarding service, disabled TLS verification, or copied credentials were used. Their code supports product-design observations, **not current legal or financial-policy claims**.

- **Money Advice Service mortgage calculator:** [repository](https://github.com/moneyadviceservice/mortgage_calculator). The public repository links to the service's mortgage tool. Retrieved source revision: `2e265e363d8e3d1130bede9352ee8268e5a4466a`; last commit at that revision: 22 March 2023. GitHub reports the repository archived on 10 July 2025. Read [outgoings model](https://github.com/moneyadviceservice/mortgage_calculator/blob/2e265e363d8e3d1130bede9352ee8268e5a4466a/app/models/mortgage_calculator/outgoings.rb), [affordability model](https://github.com/moneyadviceservice/mortgage_calculator/blob/2e265e363d8e3d1130bede9352ee8268e5a4466a/app/models/mortgage_calculator/affordability.rb), and [repayment model](https://github.com/moneyadviceservice/mortgage_calculator/blob/2e265e363d8e3d1130bede9352ee8268e5a4466a/app/models/mortgage_calculator/repayment.rb) from a read-only research clone. Verified observations: committed, fixed and lifestyle costs are separately represented; affordability includes monthly net income less repayment and outgoings; missing-cost warnings exist; repayment calculations allow an interest-rate change. Adopt the transparent-input and sensitivity design. Do not adopt legacy borrowing/risk thresholds, defaults, or the model's categorisation of food as a lifestyle cost without a current suitability and user-needs review.
- **HMRC income-tax submission frontend:** [retrieved README](https://github.com/hmrc/income-tax-submission-frontend). Public HEAD observed on retrieval: `dd0cdca78dfdf913313822f1d8031a54ee8d9860`. The README describes a service for viewing and completing an income-tax submission and gives example data with separate employment, interest, dividends, property, pension-relief, pension-charge, and State Pension fields. Verified design implication: an investment balance alone cannot stand in for the contribution, relief, charge and income records needed for tax or pension planning. The example contains historical/legacy fields and synthetic values; it is not proof that any named charge or allowance still applies.

An attempted Money Advice Service `budget_planner` repository URL returned 404 and was not used as evidence. No authoritative current ISA, pension, rental-tax or retirement-standard numbers were established from the accessible code sources.

## Existing strengths

- A double-entry journal, decimal currency calculations in many financial modules, import deduplication, and explicit transfer reconciliation form a useful foundation.
- CSV import and optional banking connectors already support transaction collection and categorisation.
- Property management is relatively mature: ownership attribution, valuations, mortgages and rate history, tenancies, rental schedules, expenses, owner tax-year reports, and sell-versus-hold scenarios exist.
- Monthly budgets, savings goals, manually valued investments, owner-level net-worth views, documents, and AI tools already exist. The app is more than a spending tracker.
- The web application has a substantial existing test suite. Production authentication is designed to fail closed without its required configuration.

## Gaps found before this improvement pass

These describe the reviewed starting point; the implementation may fix individual items. Confirm their final status against the change and tests.

| Priority | Finding and source | Practical consequence |
| --- | --- | --- |
| P0 | `web/src/components/dashboard/SavingsRateCard.tsx` derives income from lifetime account balances and sums all monthly rows without separating income from expenses. | The headline savings rate mixes periods and can count income as spending. |
| P0 | `web/src/lib/repos/budget.repo.ts` sums all book entries; a left join to an expense account does not filter out the other account entries. | Balanced journals can cancel to zero, understating budget spending. |
| P0 | Several fetchers and API failure paths return empty arrays rather than distinct unavailable states. | An unavailable database can appear to be a healthy zero-spending month. |
| P0 | `web/src/lib/properties/personal-net-worth.ts` explicitly omits standalone liabilities. | Credit cards and loans can be missing from owner net worth. |
| P1 | Investments hold a wrapper/type and periodically updated balance, with no structured holdings, asset allocation, fees, contributions, or statement freshness. | The app cannot evaluate diversification, track allowance usage, or distinguish contributions from returns. |
| P1 | Pensions are currently just an investment kind. | Defined-benefit benefits, employer contributions, retirement age, State Pension, and retirement-income planning are missing. |
| P1 | `web/src/lib/ai/prompts.ts` presents the model as an expert personal financial adviser and relies on a disclaimer. | The product can overstate its authority and give confident recommendations without a suitability assessment. |
| P1 | The existing AI health check uses fixed savings-rate bands, mortgage-only debt, and a three-month total-expense emergency target without measured liquid reserves. | A broad health label can hide missing data and unsupported assumptions. |
| P1 | Tax modules have tax-year sources and provisional flags, but comments limit some calculations to England/Wales/Northern Ireland; scenario modules also contain fixed assumptions. | A general UK adviser must make region, tax year, exclusions, and estimate status explicit. |
| P2 | Spending reduction lacks a dedicated workflow linking recurring merchant patterns to a reviewed cancellation/change decision. | Seeing categories is insufficient to act on avoidable costs. |
| P2 | Data export, recovery, accessibility, reconnect/failure behaviour, and end-to-end validation need a production acceptance review. | A finance app needs trust and dependable daily use in addition to attractive reports. |

## Conservative design principles

These are proposed product principles based on financial-planning fundamentals. They are not quotations from, or findings freshly verified against, the blocked sources.

1. **Establish reliable cash flow first.** Income and expenses must cover the same period. Exclude internal transfers and investment valuations. Offset refunds against their corresponding expense category instead of treating all absolute values as new spending. Show the period, data coverage, unclassified transactions, and missing accounts.
2. **Separate necessity from personal preference.** Identify recurring costs and changing merchant/category spending; let the user mark essential commitments. A suggested saving is an estimate based on a user-selected action, not a claim that a transaction is wasteful. Do not automatically cancel services or encourage missed debt, rent, tax, or insurance payments.
3. **Maintain a liquid reserve appropriate to the household.** Express a user-set target in months of essential costs. Only include cash genuinely available for emergencies; exclude property equity, pensions, and volatile investments. Distinguish a planning target from actual reserve coverage. Employment stability, dependants, repairs, and rental vacancies can change the target.
4. **Understand debts before investing surplus.** Capture balances, APRs, minimum payments, promotional expiry dates, and arrears. Priority debts and essential payments deserve attention before an interest-rate ranking. Repayment calculators must show fees and early-repayment assumptions. Refer users with arrears or unaffordable commitments to appropriate free debt guidance.
5. **Invest according to purpose, horizon, liquidity needs, and ability to bear losses.** Explain diversified asset classes, concentration, charges, and wrapper tradeoffs. Avoid selecting individual securities or implying guaranteed returns. Display scenario ranges with editable assumptions; stress tests are illustrations, not probabilities or forecasts.
6. **Track pension types separately.** A defined-contribution pot is an invested balance; a defined-benefit pension is a promised income subject to scheme terms. Do not represent DB income as a guessed investable pot or recommend transfers. Use the user's official State Pension forecast rather than assuming full entitlement. Compare retirement expenditure and income in consistent, inflation-adjusted units.
7. **Treat a property as cash flow, an illiquid asset, and an obligation.** Show scheduled versus received rent, arrears, operating expenses, mortgage interest and principal separately, vacancy/repair reserves, and debt-rate sensitivities. Gross rental yield is not net return. Tax estimates need the correct owner, letting structure, jurisdiction, and year; legal compliance reminders need verified regional rules and user records.
8. **Make the adviser explain its evidence.** Each action should state its trigger, calculation, assumptions, confidence/data limitations, tradeoff, and a reversible next step. Ask for missing suitability information before investment or pension-specific guidance. Keep deterministic calculations outside the model, treat imported descriptions/documents as data rather than instructions, and require review before consequential financial changes.
9. **Make tax facts versioned and reviewable.** Do not hardcode a remembered ISA limit, pension allowance, access age, CGT allowance, or tax threshold as current guidance. Verify rules for the relevant tax year and circumstances; distinguish contributions from balances and statutory allowances from a user's remaining entitlement.

## Prioritised roadmap and acceptance evidence

This roadmap identifies the broader product ambition; it is not a checklist of features completed in this pass. The delivered changes are recorded below.

| Stage | Deliverable | Minimum evidence before claiming it works |
| --- | --- | --- |
| 1 | Accurate period-based overview and actionable spending review | Income/expense/transfer/refund fixtures; incomplete periods; unavailable-data states; budgets reconcile with transaction totals. |
| 1 | A finance planning workspace | Editable household assumptions, liquid-reserve target, goal priorities, debt payment scenarios, investment concentration, pension scenarios, and property portfolio signals. Clearly identify browser-local versus server-persisted information. |
| 1 | An explainable action queue | Every suggestion is derived from actual data or a labelled user assumption, links to the relevant workflow, and does not imply that a detected recurring payment is a confirmed subscription. |
| 2 | Persistent personal financial plan | Validated schema/migration, secure server storage, version history, export, owner attribution, audit records, and real-database integration tests. No live credentials committed. |
| 2 | Full debt and retirement records | Non-mortgage debts included without double counting; DC/DB/State Pension separation; contributions and charges; tax-year allowance tracking; drawdown scenarios show inflation and uncertainty. |
| 2 | Property operating calendar and rent ledger | Received versus expected rent, arrears, tenancy changes, vacancy costs, reserve forecasts, and jurisdiction-specific compliance dates validated against records. |
| 3 | Production finance-assistant controls | Verified official knowledge sources, periodic rule updates, suitability questions, prevention of unsupported product recommendations, prompt-injection tests, model/data privacy review, and reviewed consequential actions. |
| 3 | Dependable daily service | Successful database-backed build and end-to-end checks, bank reconnection/sync recovery, backup-and-restore exercise, export portability, accessibility/mobile checks, monitoring, and realistic performance tests. |

“Best in the world” is a product ambition, not a verifiable result of one change. Assess progress through measurable user outcomes: accurate reconciled cash flow; time saved categorising; reviewed recurring-cost savings; progress towards personal goals; correct rent/expense records; and clear, reproducible planning decisions. Marketing and UI labels should describe delivered behaviour precisely.

## Delivered in this improvement pass

- A shared decimal planning engine, household ledger adapter and read-only overview API now connect a financial plan, spending review, investment/property overview, dashboard actions and AI tools. Missing periods and inferred cash accessibility are disclosed. Refunds offset spending, internal transfers are excluded, budgets use stable category IDs and descendants, and current balances exclude future entries.
- The dashboard savings-rate and monthly-spending calculations now use matching periods and signed income/expense legs. Personal net worth includes attributed non-mortgage liabilities and discloses unattributed shared debt; mortgages are excluded only when their corresponding property equity is included.
- Investment balance updates now calculate their adjustment through the requested date. The row lock and atomic balanced-journal write are preserved; the updated SQL function must be applied through the migration before live use. Boundary validation applies to both API and AI callers.
- A validated server-persisted planning profile supports essential costs, reserve months, savings targets, horizon, risk preference and a personal pension scenario. The household pension total remains separate from the selected personal scenario pot. Version history, multiple personal profiles and optimistic concurrency remain future work.
- Spending review compares six completed months, explains recurring-payment candidates, supports merchant/category search and turns an explicitly selected reduction into a category budget. A candidate is not a confirmed subscription; cancellation and bank-money movement are not automated.
- Savings goals have a direct create/edit/progress/status workflow with deadline-aware monthly contribution planning. Goal allocations are explicitly separate from account balances and are not added to net worth.
- Defined-contribution pension planning separates personal and employer deposits, growth, charges, inflation, State Pension start age and desired real income. Downside/base/upside scenarios are editable deterministic illustrations. Defined-benefit promises, pension tax charges, verified allowance usage and full drawdown modelling remain future work.
- AI guidance reads the deterministic plan, states assumptions and requests missing suitability facts. It does not claim to be a licensed expert, make individual-security selections or present unverified current tax allowances as facts. No live model run was possible without an AI Gateway key.
- Local fonts make production builds independent of Google Fonts. Unavailable APIs display failure states rather than fictitious zero balances. Automated regression tests include real disposable PostgreSQL SQL; browser verification uses synthetic intercepted persistence writes and checks mobile layouts and save failures.

The user's live Neon connection and live bank/model integrations were not configured during this pass. Database migration and end-to-end live-data acceptance remain required before reporting production readiness. See [the web setup and workflow guide](../web/README.md).

### Validation recorded on 11 October 2026

- Full web suite: **653 tests passed in 56 files**, with the disposable PostgreSQL integration tests enabled and no skipped tests.
- Full TypeScript check passed; ESLint passed with no errors and 41 pre-existing warnings.
- Production build passed with all new finance pages. Live database migration was explicitly skipped because `DATABASE_URL` was absent.
- Browser checks passed for plan/spending, pension and savings-goal flows, including unavailable storage, synthetic persistence contracts, invalid inputs, saving races and 390px layouts. These were not a live banking or live AI test.
- Python onboarding baseline: 40 tests passed and the terminal app's headless navigation/export smoke checks passed. This change does not alter Python source.
