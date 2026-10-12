Saved transactions are processed through `processCategorization` and
`POST /api/journal/auto-categorize`. Each pass is bounded, holds a short lease,
and applies only validated decisions to unchanged eligible journals. Uncertain
results stay in the review queue. Confirmed exact-context mappings can resolve
matching queued transactions on a later pass.

`deferredReason` distinguishes a normal time limit (`time_budget`) from missing
configuration, invalid or failed model responses, missing categories and busy
processing. Clients may continue a bounded pass after a time limit if there was
persisted progress and eligible work remains.

`POST /api/ai/categorize` is a **read-only legacy preview**. It accepts at most
25 descriptions of 600 characters and 100 category names of 120 characters.
It keeps its description-to-category response shape and sends
`X-Finadviser-Preview-Only: true`. It never changes saved journals, creates
rules or records reviewed decisions. Descriptions alone lack amounts, account
direction and other context, so ambiguous results remain unmatched. Use the
saved-transaction service for actual processing.
