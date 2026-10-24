import type { CategorizationCandidate } from '../types';

export type PayeeIdentityKind = 'merchant' | 'description' | 'bank_payee';
export type PayeeScope = {
  accountId: number;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY';
  ownerId: number | null;
  direction: -1 | 1;
  currency: string | null;
  propertyId: number | null;
};
export type PayeeIdentity = { kind: PayeeIdentityKind; value: string; label: string };
export type PayeeMemory = {
  id: string;
  revision: number;
  status: 'active' | 'disabled' | 'conflicted';
  scope: PayeeScope;
  payeeName: string;
  purpose: string | null;
  categoryId: number;
  categoryName: string;
  identityKind: PayeeIdentityKind;
  aliases: string[];
  sourceJournalId: number | null;
  createdAt: string;
  updatedAt: string;
};
export type PayeeLearningContext = {
  record: Pick<CategorizationCandidate, 'description' | 'merchantName' | 'snapshot'> & { journalId: number; categoryId: number | null };
  scope: PayeeScope | null;
  identities: PayeeIdentity[];
  eligible: boolean;
  reason: string | null;
  existingMemory?: PayeeMemory | null;
};
export type PayeeMatch = { memory: PayeeMemory; identity: PayeeIdentity };
