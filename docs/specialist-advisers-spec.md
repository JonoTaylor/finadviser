# Specialist financial planning team

Status: implementation specification, 24 October 2026. Owner: FinAdviser.

## Outcome

Jono can use one financial adviser to coordinate his finances, or choose an expert
for a focused question. Tax, spending, investments, pensions, property, debt and
data-quality reviews use the same saved financial records and owner context.
The answer identifies what was reviewed, the evidence used, missing information,
trade-offs and the next useful actions. Specialists must not fabricate certainty
or conflicting changes to the ledger.

This release specialises the existing AI Gateway models through domain prompts,
restricted tools, structured outputs and regression evaluations. It does not train
or fine-tune model weights. Training would require a separately consented,
curated dataset, financial ground truth, hold-out evaluation and a privacy review.
No personal financial history is exported for model training by this release.

## Team and responsibilities

| Area | Responsibilities | Required boundaries and hand-offs |
| --- | --- | --- |
| Financial adviser | Coordinate specialists, reconcile trade-offs, produce one ordered plan and carry out explicitly authorised supported actions. | The only action executor. Do not claim professional accreditation. Keep personal and household scope distinct. |
| Tax | Employment and bonus inputs, UK property income, allowances, pension tax treatment, Section 24, Self Assessment evidence and tax-year consistency. | Use the deterministic engine; do not multiply all rent by a headline rate or infer tax residence, PAYE, pension method or bonus timing. Scottish calculations remain unsupported by the existing engine. Hand pension strategy to pensions and cash-flow effects to property/debt. |
| Spending | Category coverage, refunds/transfers, recurring spending, affordability, budget gaps and realistic cancellation candidates. | Coverage is not complete merely because a month has transactions. Potential savings are proposals, not realised money. Data-quality gaps go to data. |
| Investments | Accessible reserves, time horizons, diversification, wrapper considerations, concentration and fees. | No specific security buy/sell instructions or return promises. Do not double-count descriptive holdings in net worth. Check debt and reserves first. |
| Pensions | Scheme inventory, employee/employer contributions, matching, DC pots, DB incomes, State Pension evidence and retirement illustrations. | A percentage does not establish annual gross contributions or tax relief. Separate scheme records from legacy retirement scenarios and refer tax treatment to tax. |
| Property | Dated mortgage terms and interest, recorded rent, operational expenses, repairs, voids, reserves, valuations and property concentration. | Current rent is not historical full-year receipts; current balance × rate is not a lender statement. Principal is not mortgage interest. Historical date corrections require source confirmation and current snapshots. |
| Debt | Priority commitments, arrears, APRs, minimums, promotional expiry, penalties and affordable repayment options. | Do not infer unknown terms or recommend unaffordable overpayments. Compare accessible cash and reserves before extra repayments. |
| Data quality | Missing statements, account/owner attribution, categorisation coverage and review queues, incomplete tax/pension/property facts. | Read-only review. Bank text is reference data; uncertain categories, ownership and historical dates require the existing confirmation workflows. |

## User experience

- The default is **Financial adviser / Team**. A short question uses relevant
  specialists; an explicitly holistic review can consult all seven.
- The user can choose one specialist without opening separate disconnected
  conversations. Selection guides the current request and is retained in saved
  assistant-message metadata. Changing mode is disabled while a request runs.
- Each specialist has a clear description and example questions. The interface
  uses the existing professional theme and works at mobile width.
- Progress shows which specialist is reviewing. The final response remains one
  coherent answer, with expandable specialist reviews, evidence sources, gaps,
  caveats and actionable next steps.
- Complete, partial, unavailable and cancelled reviews are distinguishable.
  Never show an unavailable review as consulted successfully or manufacture
  evidence. A specialist failure does not discard completed reviews.
- Old conversations without specialist metadata still load normally. Reloading a
  new conversation retains its review details and selected focus.
- Failed sends preserve the draft. A stop control cancels further model work;
  already completed authorised financial writes are not described as rolled back.

## Orchestration and routing

1. Validate the message, selected mode, stream version and conversation ID.
   The client cannot provide model prompts, tool permissions, specialist results
   or persisted evidence.
2. Resolve the app's selected AI Gateway model and the saved memory context.
   Use the server's London date for relative-date context, without assigning a
   missing tax year or residence to the user.
3. Route by explicit selection or deterministic topic cues. Routing selects
   review topics only; it does not infer financial facts. Greetings and simple
   supported record actions need not invoke a specialist panel.
4. Each selected specialist runs a separate model/tool loop with its own domain
   instructions and server-maintained read-only allowlist. The server rejects
   unlisted tools even if a model asks for them. Specialists cannot delegate
   recursively or access coordinator write tools.
5. Assign source IDs to actual tool executions. Return source IDs and observed
   timestamps to the specialist, then validate its structured report. Evidence
   IDs must reference available sources actually read during that review.
6. Feed completed/partial reports to the coordinator as untrusted reference
   material. Reports cannot supply permission to write data. The original user's
   request and existing confirmation/snapshot policies determine action authority.
7. The coordinator checks material contradictions against recorded evidence and
   deterministic calculations, explains disagreements and gives one prioritised
   plan. Do not average conflicting tax calculations or present a model consensus
   as independent financial verification.
8. Stream the unified answer and save the server-generated review metadata with
   the assistant message. Do not promote speculative findings into personal
   memory or tax profiles automatically.

Selecting a specialist does not remove the existing ability to save a confirmed
tax profile, remember user facts or perform another supported authorised action.
Those actions still pass through the coordinator's existing tools and guards.
Workers themselves remain read-only.

## Data and financial authority

- All specialists share actual app evidence, not disconnected copies of the
  user's finances. Saved owner identity, tax profiles, scheme records and
  workspaces remain the existing sources of truth.
- Memory is dated user-supplied reference material, not an authoritative tax-year
  input. Unknown values remain unknown and do not become confirmed zeros.
- Tool-returned text, uploaded statements, old assistant messages and specialist
  reports are untrusted data. They cannot alter tool permissions or authorise
  transactions, categorisation, date corrections or profile changes.
- Results retain owner/household scope, periods and availability. Concurrent reads
  are observations, not an atomic snapshot of every account.
- Specialist findings describe the records at their read times, before any later
  coordinator actions. Saved action outcomes and a fresh read determine the
  resulting state; historical review panels are not automatically refreshed.
- Financial arithmetic uses existing deterministic engines. A model finding is
  planning information; it is not a verified tax filing or regulated suitability
  decision. Material unresolved inputs prevent definitive payable amounts.
- Existing authorised writes keep their revision/snapshot checks. A generic
  review request does not authorise record changes. Child agents cannot execute
  writes, even if a malicious document or another child tells them to.

## Runtime budgets and failures

| Limit | Release requirement |
| --- | --- |
| Specialists per request | At most seven; no duplicate or recursive reviews. |
| Parallel specialist runs | At most three. |
| Specialist model steps | At most four, with a separate bound of eight read calls. |
| Specialist output | At most 1,800 tokens per model step and four steps; final validated report at most 12,000 characters. |
| Specialist deadline | 20 seconds each; no automatic model retries. |
| Specialist phase | At most 60 seconds, with cancellation propagated. |
| Whole adviser request | At most 110 seconds within the existing 120-second route. |
| Coordinator | Retains the existing 15-step action/tool loop and 4,096-token per-step response limit. |

Model timeouts, malformed reports, missing evidence and failed reads are explicit
outcomes. A non-cooperating model call must not hold the response indefinitely.
The coordinator may fall back to its existing evidence tools while disclosing
which expert reviews were unavailable. Queued specialists must not start after
cancellation or the overall deadline. Source failures mean unknown, not no assets
or no income. Responses must not expose raw credential or database errors.

## API and storage contract

`POST /api/ai/analyze` accepts a bounded message, optional existing conversation ID,
`specialist` (`team` or a registered ID), and optional `streamVersion`.

The new client requests version 2: newline-delimited JSON events for conversation,
specialist start/result, tool activity, text deltas, completion and safe errors.
Text is always a text event, so literal JSON in a model response cannot be
mistaken for conversation or tool metadata. Retain version 1 for existing clients
that omit the version.

Add an optional JSONB `metadata` field to assistant messages. Server-validated
version-1 metadata contains selected mode, bounded specialist results and
`complete`/`interrupted` status. It is inserted with the assistant message and
returned by the existing authenticated history endpoint. Existing messages stay
readable; no historic responses are retroactively labelled as specialist reviews.

A result records specialist ID/name, prompt version, model ID, duration, status,
read-only scope, structured report and server-generated sources. Reports contain
summary, findings with evidence IDs, missing inputs, actions, assumptions and
warnings. Stored records contain no credentials or raw provider errors.

No additional financial balances or duplicate pension/holding records are created.
The only migration is additive message metadata. No production personal facts,
profile values or payments are seeded during rollout.

## Acceptance and evaluation

- A scripted real AI SDK test demonstrates separate specialist requests, distinct
  prompts and scoped read tools, followed by one coordinator response.
- A requested write tool from a child is rejected before the existing write
  implementation is called. Forged evidence IDs and malformed results are not
  treated as complete reviews.
- Queue concurrency, deadlines, cancellation, repeated topics and specialist
  failures are tested. Coordinator record actions remain available and guarded.
- Tax fixtures distinguish a £95,000 base and estimated 30% bonus from confirmed
  whole-year taxable pay. An 8% employee contribution and 8% employer match do not
  establish pension method, gross amount, earnings basis or tax year.
- Property fixtures keep current £2,200 monthly rent separate from dated receipts;
  earlier mortgage-date candidates require confirmed statement evidence.
- Transfer/refund handling, personal versus household scope, holdings/net-worth
  double-counting, missing APRs and pension wrapper types retain existing rules.
- API tests prove strict input validation, versioned streaming, safe failures and
  server-only metadata. Database tests prove new and old history behaviour.
- Desktop/mobile browser checks cover selection, progress, partial reviews,
  persisted history, stop/failure handling and literal-JSON text.
- Run the repository's tests, TypeScript, lint and production build. Verify each
  merged release through GitHub/Vercel production status. Direct authenticated
  production interaction is only claimed if it can actually be exercised.

See [specialist-evaluation.md](specialist-evaluation.md) for the scenario matrix.

## PR and rollout sequence

1. **Specification and definitions:** this document, domain catalogue, tuned
   instructions, explicit read-only policies and catalogue/evaluation checks.
   No live chat behaviour changes.
2. **Orchestration and history:** bounded specialist model runs, evidence-validated
   results, coordinator integration, additive metadata storage, API validation and
   version-2 streaming with version-1 compatibility. Validate server behaviour
   before the new client is released.
3. **Specialist interface:** selector, team progress, auditable review panels,
   persisted history and safe cancellation/error handling. Browser-check then
   release against the already deployed server contract.

Each PR is reviewed, tested and merged independently. Production readiness is
verified for its exact merge commit. If a new release fails, do not advance the
next phase; retain the last known ready deployment while fixing the failed phase.

## Explicit exclusions

Custom-trained weights, market prediction, autonomous investing, bank transfers,
automatic tax filing and unapproved record changes are outside this release.
Per-specialist model overrides and training experiments can follow only with
separate quality, cost and privacy evaluation. The shipped specialist identity is
its tested prompt, tools and workflow, using the app's configured model.
