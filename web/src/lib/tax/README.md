# Saved personal facts and tax profiles

The adviser has separate stores for conversational memory, the confirmed personal
owner selection, and each owner's tax-year profile. Saving one does not claim that
the others have been updated. Read back the persisted tool response before
confirming a save. No conversation examples are seeded into live records.

`get_financial_identity` / `save_financial_identity` reuse the financial context's
revision guard. The selected owner must exist; selecting a person does not change
property ownership, account attribution or household reporting scope.

`get_owner_tax_profile` / `update_owner_tax_profile` require an explicit owner and
valid tax-year label. Updates supply the revision actually read. A single atomic
row update stores money, facts, provenance and the next revision together.
Concurrent creations and stale updates conflict rather than replacing newer data.
Browser PATCH and PUT requests have the same revision requirement.

Money remains compatible with existing numeric ledger/report code. `knownFields`
distinguishes an explicit zero from a storage placeholder. Clearing a value with
`null` restores unknown; omitted fields are unchanged. Legacy zero defaults are
unknown until confirmed. Salary/bonus facts do not replace an explicitly entered
whole-year employment figure. A bonus is either an amount or a percentage, retains
its estimate status, and is never copied to another year automatically.

Pension treatment requires an explicit method and meaningful annual contribution:

- Salary sacrifice and net pay reduce gross-before-pension employment once. A
  taxable-pay figure already reflects the deduction and is not reduced again.
- Relief at source uses the gross qualifying personal contribution, reduces
  adjusted net income and extends the income-tax bands. It does not subtract the
  contribution from employment income. A percentage alone cannot establish its
  gross amount.
- Employer matching is recorded for context and never deducted as an employee
  contribution. Qualifying earnings, annual-allowance charges, Gift Aid and
  individual relief eligibility are not inferred.

The tax engine models England/Wales/Northern Ireland rules; unknown residence and
Scotland remain explicit gaps. `taxOnRentalIncome` is the difference between
total liability with property and the same calculation without it, including the
personal allowance taper and Section 24 limits. It is not simply profit multiplied
by a headline rate. Pension contributions can reduce total tax while increasing
the incremental amount attributed to property.

`profileGaps`, `profileComplete` and `estimateOnly` describe readiness. Missing
PAYE or other material profile facts prevent an estimated balance payable from
being presented as an amount to pay. Recorded property amounts do not prove a
complete tax year: verify rent, deductible expenses and dated mortgage interest.
Current rent or mortgage balance multiplied by today's rate is not historical
tax-year evidence. Every result remains an estimate for review before filing.

Official rule references are recorded in `taxRates.ts` and returned with each
calculation. Regression tests cover the allowance taper, pension methods,
Section 24 limits, owner/year isolation and real PostgreSQL compare-and-swap
operations. Optional PostgreSQL tests use only the disposable fixture specified
by `DATA_PLAN_TEST_PG_URL`, never the production database.
