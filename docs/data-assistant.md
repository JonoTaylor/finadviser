# AI data processing

The Data assistant (`/data`) brings transaction processing, unresolved questions and missing financial information into one workspace. Categorisation changes category metadata and stores its evidence; it does not assign account ownership, infer a property link or change financial balances.

## Automatic processing

- New CSV/PDF imports and bank syncs await the existing transfer reconciliation before a bounded categorisation pass. Failed processing preserves the successful import or sync and reports unknown counts when a partial save cannot be confirmed.
- The dashboard continues eligible records in up to five sequential passes while the tab is visible. The Data assistant can continue up to 100 passes, with a control to stop after the current pass. A normal time-budget boundary can continue after durable progress; unavailable models, conflicting workers and unchanged batches stop.
- The existing daily bank-sync cron also processes the outstanding backlog, including days with no new bank transactions. Its configured Vercel schedule and `CRON_SECRET` remain prerequisites for the scheduled run.
- Each pass considers at most 100 journals. AI receives batches of at most 25, with one shared model time budget. A database lease prevents overlapping workers; snapshot guards keep newer edits and changed transaction context.

## Categories and decisions

The processor uses actual journal IDs, merchant hints, signed account postings, account types, owner assignments and property context. It validates the model response against the supplied IDs and existing categories. Model confidence is an estimate, not a calibrated probability. Existing categories are preserved.

Known rules and explicitly remembered matches run first. AI suggestions meeting the 0.90 confidence threshold can be applied only when the account context is unambiguous. Possible transfers, debt repayments, refunds reducing a liability and other ambiguous movements remain review questions; a transfer category alone does not reconcile the financial postings.

Review decisions carry the current transaction snapshot. Approve or correct a category, or leave the record uncategorised. Remembering is optional and defaults off. A remembered correction applies only to the exact account, owner, direction, description, merchant and property context; it can also resolve matching records already in review. Legacy unreviewed AI rules are ignored. Explicit edits in the rule editor approve a rule as a user rule.

The metadata tables are `transaction_categorizations`, `categorization_learning` and `categorization_processing_lease`. Their migration is additive and idempotent. Review and processing endpoints return private/no-store responses or no-store responses; provider errors and financial prompt bodies are not logged by the new processor.

## Missing information and adviser

Read-only coverage checks use saved workspaces and aggregated ledger queries. They identify missing or stale statement periods, uncertain cash accessibility, owner/context facts, planning assumptions, debt terms, investment valuations/fees, pension scheme/forecast inputs and property records. Empty, incomplete, stale and unavailable sources remain distinct. A recorded month does not establish complete coverage of every bank account or day.

Each gap includes its source, why it affects the assessment and an action link. The adviser reads these gaps with the existing financial workspace before giving guidance and asks for specific missing evidence instead of inventing personal facts. General financial analysis remains read-only; requested categorisation uses the shared processor.

`DATABASE_URL` and `AI_GATEWAY_API_KEY` must be available on the application server for persisted AI processing. The existing model setting selects the gateway model. Without a configured model, approved rules and learned matches can still run. The legacy description-only preview endpoint remains read-only, bounded and validated; it cannot apply journal changes.
