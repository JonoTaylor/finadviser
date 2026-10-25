Saved transactions are processed through `processCategorization` and
`POST /api/journal/auto-categorize`. Each pass is bounded, holds a short lease,
and applies only validated decisions to unchanged eligible journals. Missing
financial facts stay in the review queue. Confirmed exact-context mappings can resolve
matching queued transactions on a later pass.

Exact Prime, Xbox Game Pass, Monzo, Plex and Google storage descriptors have
deterministic service matches. Explicit user-confirmed knowledge and saved rules
take precedence. Ordinary purchases can receive reversible estimated categories
from a matching bank hint, specific merchant description or bound public research.
Generic retail purchases can use an estimated Shopping category. Otherwise a
screened card purchase can use the visible `Spending details unknown` root bucket.
These assignments never establish income, transfers, property use or tax treatment.
`assignment_kind` distinguishes standard, estimated and broad labels; estimated
and broad labels persist no model probability for the assigned category.

`REVIEW_POLICY_VERSION` makes historical current-snapshot reviews eligible for
one automatic reassessment. `policyReassessment` distinguishes these candidates
from a policy-current question selected by new confirmed knowledge. Eligible old
spending questions can return to research and the model once; both SQL write
guards require the stale policy and the exact current context. Hard context
questions are stamped through `markReviewPolicyChecked`
under a snapshot and lease guard, preserving their evidence and review revision.
`reviewsRechecked` tracks these checks separately from new review questions or
applied categories. Human-reviewed, dismissed and applied rows stay protected.
New exact/private payee confirmations retain their separate refresh mechanism;
editing a general rule alone does not reopen policy-current questions.

`/api/categorization/activity` provides a read-only, optional-refinement view of
automatic labels and their reasons. It requires both the current category and
the original pre-assignment context fingerprint (with a null category override),
so later changes to amounts, ownership or merchant metadata do not present old
evidence as a current decision. The Data assistant starts eligible work once per
visible page visit, preserving explicit paused and cancelled job states.

`/api/data-intelligence/review-groups` groups canonical exact payment contexts,
including account, owner, direction, currency and property boundaries. It returns
at most 15 groups with 100 explicit members each. The grouped decision captures
both journal snapshots and independent suggestion fingerprints, locks in ID
order and applies all selected members or none. New arrivals and members beyond
the preview are never silently added. The optional remembered mapping commits
with the category decision; uncertain responses require observation before retry.

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
