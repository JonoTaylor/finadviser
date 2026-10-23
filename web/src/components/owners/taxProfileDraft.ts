import { ownerTaxProfilePatchSchema, type TaxProfileFacts, type TaxMoneyField } from '@/lib/tax/profileFacts';

export type TaxProfileDraft = {
  core: Partial<Record<TaxMoneyField | 'notes', string>>;
  facts: Partial<Record<keyof TaxProfileFacts, string>>;
};

/** Only edited inputs are sent. Empty fields explicitly restore “unknown”. */
export function buildTaxProfilePatch(draft: TaxProfileDraft, expectedRevision: number) {
  const facts: Record<string, string | boolean | null> = {};
  for (const [key, value] of Object.entries(draft.facts)) {
    if (key === 'bonusIsEstimate') facts[key] = value === '' ? null : value === 'true' ? true : value === 'false' ? false : value;
    else facts[key] = value.trim() === '' ? null : value;
  }
  const core = Object.fromEntries(Object.entries(draft.core).map(([key, value]) => [key, value.trim() === '' ? null : value]));
  return ownerTaxProfilePatchSchema.parse({
    expectedRevision, source: 'user', ...core,
    ...(Object.keys(facts).length ? { facts } : {}),
  });
}
