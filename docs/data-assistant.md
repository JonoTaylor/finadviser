# AI data processing

The Data assistant (`/data`) brings transaction processing, unresolved questions and missing financial information into one workspace. Categorisation changes category metadata and stores its evidence; it does not assign account ownership, infer a property link or change financial balances.

## Automatic processing

- New CSV/PDF imports and bank syncs await the existing transfer reconciliation before a bounded categorisation pass. Failed processing preserves the successful import or sync and reports unknown counts when a partial save cannot be confirmed.
- Global processing uses a saved job shared by chat, the dashboard and the Data assistant. Closing a tab or moving between pages does not cancel the server job. Controls pause or end processing after the current pass; already-saved decisions remain intact. Paused or cancelled jobs never restart merely because a page opens.
- A job captures an upper journal-ID boundary and permits at most 200 passes before requiring an explicit resume. Newer imports can start a later job. A normal time-budget boundary continues after durable progress; unavailable models, conflicting workers and unchanged batches pause instead of retrying indefinitely.
- The existing daily bank-sync cron also processes the outstanding backlog and recovers an already-authorised job whose handoff was lost. It never unpauses or creates a job during recovery. Its configured Vercel schedule and `CRON_SECRET` remain prerequisites for the scheduled run.
- Each pass considers at most 100 journals. AI starts with five-entry batches, saves each completed batch, and can retry a slow batch once as single entries. Model calls share a 20-second execution budget inside a 45-second pass; a time-budget pause leaves unprocessed records available for continuation. A database lease prevents overlapping workers; snapshot guards keep newer edits and changed transaction context.

## Durable jobs and background continuation

`categorization_jobs` deduplicates active global processing, including requests arriving simultaneously from chat and the Data assistant. Each `categorization_job_passes` record is created before processing; its acknowledgement and job totals change atomically. Progress shows only acknowledged results for that job, alongside a separately observed current backlog. It never combines approximate historical session totals. If a worker crashes after saving decisions but before acknowledging them, totals are marked incomplete and the current ledger is checked; unknown changes are never reported as zero.

Authenticated job APIs start, inspect, pause, resume or cancel jobs. Straightforward global categorisation commands use these tools directly, without a model call or specialist reviews. Scoped requests and financial analysis retain their existing controlled paths. Routine chat replies link to the saved job rather than asking the user to request each batch.

A signed internal worker returns an acknowledgement and uses Next.js `after()` to process a bounded slice, then awaits a fresh handoff for continuation. Each slice has a 75-second bound and a 90-second claim lease. Expired claims can be recovered; stale workers cannot acknowledge results or release a newer worker's lease. The existing session secret signs short-lived method/path/job-specific capabilities. Worker URLs come only from validated Vercel deployment environment variables; no browser cookies, private transaction payloads or caller-supplied origins are forwarded.

Configured background access is distinct from an accepted handoff or actual progress. Failed handoffs remain visible on the saved job. Status polling and the existing daily cron can recover queued or expired active work, with failed dispatches backed off. Deployment protection, unavailable providers or missing server configuration can still stop continuation; the UI reports those states rather than claiming work is running.

## Categories and decisions

The processor uses actual journal IDs, merchant hints, signed account postings, account types, owner assignments and property context. It validates the model response against the supplied IDs and existing categories. Model confidence is an estimate, not a calibrated probability. Existing categories are preserved.

Known rules and explicitly remembered matches run first. AI suggestions meeting the 0.90 confidence threshold can be applied only when the account context is unambiguous. Possible transfers, debt repayments, refunds reducing a liability and other ambiguous movements remain review questions; a transfer category alone does not reconcile the financial postings.

Review decisions carry the current transaction snapshot. Approve or correct a category, or leave the record uncategorised. Remembering is optional and defaults off. A remembered correction applies only to the exact account, owner, direction, description, merchant and property context; it can also resolve matching records already in review. Legacy unreviewed AI rules are ignored. Explicit edits in the rule editor approve a rule as a user rule.

## Private payment meanings

A one-off category correction and a reusable payee meaning are separate choices. **Remember this payee** saves the chosen category and a confirmed private meaning in one atomic operation. The dialog shows the source payment and scope; it can use an exact merchant, an exact description, or a bank recipient extracted only from a recognised format with an explicitly delimited reference. The latter can match recurring payments when their references change. Additional aliases must be explicitly confirmed; first-name substrings and guessed reference stripping are never enough.

The meaning is fenced by financial account, owner, direction, currency and property link. Household cleaning is distinct from rental-property cleaning, and remembering a payee never changes property attribution or establishes tax deductibility. These personal identities stay off public merchant search, including older aliases and disabled meanings.

Confirmed meanings run before AI. Matching pending reviews become eligible when new confirmed knowledge can resolve them, with snapshot and memory-revision checks at the final write. Transfers, liability credits, multiple financial account legs and conflicting meanings retain hard review safeguards. A later conflicting category correction retires the conflicting meaning; the Data assistant shows that it needs reconfirmation. Saved meanings can be inspected, edited or disabled without silently changing existing categories. Read-only lookups do not mutate saved meanings.

The adviser can read a payment's learning context, remember a user-confirmed meaning, inspect known payees or stop reusing one. General conversation memory alone does not teach the categorisation processor. These tools require current snapshots/revisions and preserve unknown or ambiguous scope.

## Gateway model comparisons

Classification uses a separate model policy from the adviser model. The app reads Vercel AI Gateway's live catalogue, compares up to three available candidates on ten fictional finance cases, and records accuracy, unsafe automatic guesses, review counts, batch latency and estimated cost. A candidate must get all ten cases right, make no unsafe automatic assignments, return valid responses and finish each five-row batch within eight seconds. Among qualified candidates the policy prefers lower measured cost, then latency. This is a small measured comparison among tested candidates, not evidence of a universally optimal or perfectly accurate model.

The first eligible background worker can run a leased comparison within a 29-second bound; a shared cooldown prevents repeated concurrent spend. Settings also provides a revision-guarded **Compare models** action. Only synthetic fixtures reach this comparison, never private transaction records or public recipient searches. A deployment model override retains priority, and an unavailable or unconfirmed comparison cannot replace a qualified selection or claim a new winner. Until a model qualifies, the current fast default remains active.

Known legacy Anthropic version spellings are translated to canonical Gateway IDs. Catalogue failures are distinguished from live catalogue results. Worker preflight, comparison, processing and handoff share an absolute deadline so model research cannot consume the time needed to save processing results.

The metadata tables are `transaction_categorizations`, `categorization_learning` and `categorization_processing_lease`. Their migration is additive and idempotent. Review and processing endpoints return private/no-store responses or no-store responses; provider errors and financial prompt bodies are not logged by the processor.

## Public merchant research

When an initial AI decision needs clarification, the processor can research up to two distinct eligible merchants in a pass. Native Vercel AI Gateway Perplexity search supplies actual public titles, URLs and snippets. Only a screened merchant name (and optional coarse location) goes to search; amounts, account details, transaction dates and raw bank references do not. Personal transfers and private-looking descriptors are skipped. The adviser can also investigate an eligible transaction with the read-only `research_merchant` tool, which selects its merchant on the server from a journal ID.

Searches have a six-second bound and use the application's existing `AI_GATEWAY_API_KEY`; no browser scraping, arbitrary URL fetching or additional search key is needed. Provider access and Gateway credits must support native search. A failed search preserves the original review question. Business identity is evidence about the merchant, not proof of what was bought or of tax deductibility. Search text remains untrusted reference data. Actual citations are stored with the category decision and shown in the review queue; the model cannot supply invented citation fields.

The bounded `merchant_research_cache` stores only screened public queries and validated public search results. Positive results expire after 24 hours, empty searches after 15 minutes. Transient errors are not cached. Cache collisions can evict a result but cannot return evidence for a different query.

## Missing information and adviser

Read-only coverage checks use saved workspaces and aggregated ledger queries. They identify missing or stale statement periods, uncertain cash accessibility, owner/context facts, planning assumptions, debt terms, investment valuations/fees, pension scheme/forecast inputs and property records. Empty, incomplete, stale and unavailable sources remain distinct. A recorded month does not establish complete coverage of every bank account or day.

Each gap includes its source, why it affects the assessment and an action link. The adviser reads these gaps with the existing financial workspace before giving guidance and asks for specific missing evidence instead of inventing personal facts. General financial analysis remains read-only; requested categorisation uses the shared processor.

`DATABASE_URL` and `AI_GATEWAY_API_KEY` must be available on the application server for persisted AI processing. Background categorisation uses `CATEGORIZATION_MODEL_ID` (default `openai/gpt-4.1-mini`) independently of the adviser model selected in Settings. Without AI credentials, approved rules and learned matches can still run. The legacy description-only preview endpoint remains read-only, bounded and validated; it cannot apply journal changes.
