import {
  buildMerchantResearchQuery, merchantResearchInputFromCandidate, recognisedRetailDescriptorBasis,
  validateMerchantResearchResult,
} from '@/lib/merchant-research/privacy';
import type { MerchantResearchResult } from '@/lib/merchant-research/types';
import type { CategorizationCandidate, CategorizationCategory, CategorizationDecision } from './types';

export type ConsumerCategoryFamily = 'groceries' | 'dining' | 'transport' | 'travel' | 'entertainment'
  | 'shopping' | 'subscriptions' | 'utilities' | 'health' | 'personal-care' | 'household' | 'education';
export type AutomaticSpendingAssessment = {
  assignmentKind: 'standard' | 'estimated' | 'broad'; categoryId: number; reason: string;
};
export type AutomaticSpendingOptions = {
  research?: MerchantResearchResult | null; privateNames?: readonly string[]; unknownCategoryId?: number;
};

function normalized(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase('en-GB').replace(/&/g, ' and ').replace(/[_/–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const forbiddenCategory = /\b(?:income|salary|wages|tax|hmrc|pensions?|investments?|isa|savings?|transfers?|repayments?|loans?|debt|mortgages?|property|properties|rent|rental|dividends?|interest|insurance|capital gains)\b/;
const categoryFamilies: ReadonlyArray<[ConsumerCategoryFamily, RegExp]> = [
  ['groceries', /^(?:groceries|grocery|supermarkets?|food and groceries)$/],
  ['dining', /^(?:dining|eating out|restaurants?|cafes?|coffee|food and drink)$/],
  ['transport', /^(?:transport|transportation|public transport|parking|fuel|motoring)$/],
  ['travel', /^(?:travel|holidays?|accommodation|flights?|hotels?)$/],
  ['entertainment', /^(?:entertainment|leisure|gaming|hobbies)$/],
  ['shopping', /^(?:shopping|retail|clothing|clothes|electronics)$/],
  ['subscriptions', /^(?:subscriptions|software and subscriptions|software subscriptions|software|digital services|cloud storage)$/],
  ['utilities', /^(?:utilities|bills|household bills|energy|electricity|gas|water|internet|broadband|mobile|phone|telecoms)$/],
  ['health', /^(?:health|healthcare|medical|dental|pharmacy|fitness)$/],
  ['personal-care', /^(?:personal care|beauty|haircuts?|hairdressing)$/],
  ['household', /^(?:household|home|home and garden|cleaning|household cleaning|home maintenance)$/],
  ['education', /^(?:education|books|courses|training)$/],
];

function categoryChain(categoryId: number, categories: readonly CategorizationCategory[]): CategorizationCategory[] | null {
  const byId = new Map(categories.map(category => [category.id, category]));
  if (byId.size !== categories.length) return null;
  const chain: CategorizationCategory[] = [];
  const seen = new Set<number>();
  let id: number | null | undefined = categoryId;
  while (id !== null && id !== undefined) {
    if (seen.has(id)) return null;
    const category = byId.get(id);
    if (!category) return null;
    seen.add(id); chain.push(category); id = category.parentId;
  }
  return chain;
}

/** A consumer leaf cannot escape a transfer, income or property ancestor. */
export function consumerCategoryFamily(categoryId: number, categories: readonly CategorizationCategory[]): ConsumerCategoryFamily | null {
  const chain = categoryChain(categoryId, categories);
  if (!chain || chain.some(category => forbiddenCategory.test(normalized(category.name)))) return null;
  for (const category of chain) {
    const family = categoryFamilies.find(([, pattern]) => pattern.test(normalized(category.name)))?.[0];
    if (family) return family;
  }
  return null;
}

/** A protected or broken category branch cannot become an ordinary spending estimate. */
export function isProtectedSpendingCategory(categoryId: number, categories: readonly CategorizationCategory[]): boolean {
  const chain = categoryChain(categoryId, categories);
  return chain === null || chain.some(category => forbiddenCategory.test(normalized(category.name)));
}

function bankFamily(value: string | null): ConsumerCategoryFamily | null {
  return categoryFamilies.find(([, pattern]) => pattern.test(normalized(value)))?.[0] ?? null;
}

const movementHint = /\b(?:transfers?|faster payments?|standing orders?|bacs|chaps|p2p|peer to peer|beneficiary|cash|atm|withdrawals?|savings?|investments?|pensions?|repayments?|loans?|debt|salary|wages|payroll|income|refunds?|reversals?|chargebacks?|mortgages?|rent|rental|tax|hmrc)\b/;
const financialIdentity = /^(?:(?:american exp(?:ress)?|amex)(?:\b|\s*\*)|fnz\b|(?:hsbc|barclays|santander|natwest|lloyds|halifax|revolut|monzo|starling)\b)/;
const bareProvider = /^(?:paypal|klarna|clearpay|stripe|square|sumup|zettle|izettle|autopay|wise|western union|moneygram|cash app)(?:\s+(?:payment|payments))?$/;
const marketplace = /^(?:amazon\b|amzn(?:mktp|mktplace|digital)?\b|ebay\b|etsy\b)/;
const cardType = /^(?:(?:(?:debit|credit) )?card(?: payment| purchase| transaction)?|pos(?: payment| purchase)?|point of sale(?: payment| purchase)?)$/;
const movementDescription = /\b(?:cash withdrawal|atm withdrawal|bank transfer|internal transfer|credit card repayment|loan repayment|salary payment|pension contribution|investment contribution)\b|^(?:payment (?:to|from)|sent to|received from)\b/;

/** An explicit movement memo remains a warning even if its imported type says card. */
export function hasMovementDescription(candidate: Pick<CategorizationCandidate, 'description'>): boolean {
  return movementDescription.test(normalized(candidate.description));
}

/** Financial rails do not establish a consumer purchase, at any confidence. */
export function isFinancialOrBarePaymentProvider(candidate: Pick<CategorizationCandidate, 'merchantName' | 'description'>): boolean {
  return [candidate.merchantName, candidate.description].some(value => {
    const identity = normalized(value).replace(/^(?:(?:debit|credit) )?card (?:payment|purchase|transaction)(?: to)?\s+|^pos(?: purchase)?\s+/, '');
    return financialIdentity.test(identity) || bareProvider.test(identity);
  });
}

function semanticFamily(merchant: string): ConsumerCategoryFamily | null {
  if (/\b(?:restaurant|cafe|café|sushi|desserts?|coffee|pizzeria|pizza|bakery|takeaway)\b/.test(merchant)) return 'dining';
  if (/\b(?:supermarket|grocer|groceries|tesco|sainsbury|waitrose|morrisons|lidl|aldi)\b/.test(merchant)) return 'groceries';
  if (/\b(?:car park|carpark|parking|petrol|fuel station)\b/.test(merchant)) return 'transport';
  return null;
}

function matchedResearch(candidate: CategorizationCandidate, research: MerchantResearchResult | null | undefined, privateNames: readonly string[]): boolean {
  const evidence = validateMerchantResearchResult(research);
  if (!evidence || evidence.status !== 'matched' || evidence.sources.length === 0) return false;
  const input = merchantResearchInputFromCandidate(candidate, privateNames);
  const expected = input ? buildMerchantResearchQuery(input) : null;
  return Boolean(expected && evidence.query?.toLocaleLowerCase('en-GB') === expected.query.toLocaleLowerCase('en-GB'));
}

function unknownCategory(options: AutomaticSpendingOptions, categories: readonly CategorizationCategory[]): number | null {
  const matching = categories.filter(category => normalized(category.name) === 'spending details unknown' && category.parentId == null);
  if (matching.length !== 1 || (options.unknownCategoryId !== undefined && matching[0].id !== options.unknownCategoryId)) return null;
  const chain = categoryChain(matching[0].id, categories);
  return chain && !chain.some(category => forbiddenCategory.test(normalized(category.name))) ? matching[0].id : null;
}

/**
 * Assign reversible consumer labels, never transfer destinations, income or tax
 * treatment. Model confidence alone cannot promote a lower-confidence guess.
 * The caller retains the underlying model confidence and records assignmentKind.
 */
export function assessAutomaticSpending(
  candidate: CategorizationCandidate,
  categories: readonly CategorizationCategory[],
  decision: Pick<CategorizationDecision, 'categoryId' | 'confidence' | 'reason' | 'status'>,
  options: AutomaticSpendingOptions = {},
): AutomaticSpendingAssessment | null {
  if (candidate.propertyId !== null || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) return null;
  const financial = candidate.legs.filter(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
  if (financial.length !== 1 || !Number.isFinite(Number(financial[0].amount)) || Number(financial[0].amount) >= 0) return null;
  const type = normalized(candidate.transactionType);
  const hint = normalized(candidate.bankCategory);
  if (movementHint.test(type) || movementHint.test(hint)) return null;
  const merchant = normalized(candidate.merchantName);
  const description = normalized(candidate.description);
  if (hasMovementDescription(candidate)) return null;
  if (isFinancialOrBarePaymentProvider(candidate)
    || /^(?:mr|mrs|ms|dr)\s/.test(merchant || description)
    || /^[a-z]\s+[a-z]+$/.test(merchant || description)) return null;
  const privateNames = options.privateNames ?? [];
  if (privateNames.some(name => {
    const value = normalized(name);
    return value.length >= 3 && (merchant.includes(value) || description.includes(value));
  })) return null;
  const publicInput = merchantResearchInputFromCandidate(candidate, privateNames);
  const query = publicInput ? buildMerchantResearchQuery(publicInput) : null;
  if (!query || financialIdentity.test(normalized(query.merchantName)) || bareProvider.test(normalized(query.merchantName))) return null;
  const explicitPurchase = cardType.test(type);
  const evidenceMatched = matchedResearch(candidate, options.research, privateNames);
  const hintFamily = bankFamily(candidate.bankCategory);
  const recognisedStatement = recognisedRetailDescriptorBasis(candidate);
  if (!explicitPurchase && !(evidenceMatched && (hintFamily !== null || recognisedStatement))) return null;

  const selected = decision.categoryId === null ? null : categoryChain(decision.categoryId, categories);
  if (decision.categoryId !== null && (!selected || selected.some(category => forbiddenCategory.test(normalized(category.name))))) return null;
  const family = decision.categoryId === null ? null : consumerCategoryFamily(decision.categoryId, categories);
  const isMarketplace = marketplace.test(normalized(query.merchantName));
  if (isMarketplace) {
    const shopping = categories.filter(category => normalized(category.name) === 'shopping' && consumerCategoryFamily(category.id, categories) === 'shopping');
    if (explicitPurchase && shopping.length === 1) return { assignmentKind: 'estimated', categoryId: shopping[0].id,
      reason: 'An outgoing retail purchase is recorded. Shopping is a broad estimate; the specific items and tax treatment are unknown.' };
    return null;
  }
  if (family && decision.categoryId !== null && decision.confidence >= 0.75) {
    const support = evidenceMatched || hintFamily === family || semanticFamily(normalized(query.merchantName)) === family;
    if (decision.confidence >= 0.9 || support) return { assignmentKind: decision.confidence >= 0.9 ? 'standard' : 'estimated', categoryId: decision.categoryId,
      reason: decision.confidence >= 0.9 ? decision.reason
        : `Estimated spending category from the recorded purchase context${evidenceMatched ? ' and public merchant evidence' : hintFamily === family ? ' and matching bank category' : ' and merchant description'}. You can correct it later; no tax treatment has been inferred.` };
  }
  // Keep expenditure visible even when its merchant/category cannot be narrowed.
  // This bucket is not a verified classification or a resolved financial fact.
  const broadCategory = unknownCategory(options, categories);
  if (explicitPurchase && broadCategory !== null) return { assignmentKind: 'broad', categoryId: broadCategory,
    reason: 'An outgoing card purchase is recorded, but its spending details remain unknown. It is kept in a visible broad spending bucket that you can refine later.' };
  return null;
}
