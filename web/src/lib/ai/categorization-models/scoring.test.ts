import { describe, expect, it } from 'vitest';
import { validateModelDecisions } from '@/lib/categorization/decisions';
import { BENCHMARK_CASES, BENCHMARK_CATEGORIES, benchmarkPrompt } from './fixtures';
import { scoreBenchmarkBatch } from './scoring';

const correctResponse = () => ({ decisions: BENCHMARK_CASES.map(item => ({
  journalId: item.candidate.id, categoryId: item.expectedCategoryId,
  confidence: item.expectedCategoryId === null ? 0.2 : 0.98,
  reason: item.expectedCategoryId === null ? 'The purchase purpose requires review.' : 'The supplied transaction context identifies the purpose.',
})) });

describe('synthetic categorisation model scoring', () => {
  it('scores correct categories and deliberate uncertainty across ten synthetic cases', () => {
    expect(BENCHMARK_CASES).toHaveLength(10);
    expect(scoreBenchmarkBatch(correctResponse(), BENCHMARK_CASES)).toEqual({ correct: 10, total: 10, unsafeAutoApplied: 0, invalidBatches: 0, reviewCount: 5 });
  });

  it('does not let movement guards hide unsafe raw-model transfer decisions', () => {
    const response = correctResponse();
    const transfer = response.decisions.find(item => item.journalId === 108)!;
    transfer.categoryId = 1;
    transfer.confidence = 0.99;
    // The application protects the ledger even though the raw model is unsafe.
    expect(validateModelDecisions(response, BENCHMARK_CASES.map(item => item.candidate), BENCHMARK_CATEGORIES).find(item => item.journalId === 108)?.status).toBe('needs_review');
    expect(scoreBenchmarkBatch(response, BENCHMARK_CASES)).toEqual({ correct: 9, total: 10, unsafeAutoApplied: 1, invalidBatches: 0, reviewCount: 5 });
  });

  it('does not reward low-confidence guesses for unknown people or a different owner’s payee', () => {
    const response = correctResponse();
    for (const id of [106, 110]) {
      const row = response.decisions.find(item => item.journalId === id)!;
      row.categoryId = 4; row.confidence = 0.4;
    }
    expect(scoreBenchmarkBatch(response, BENCHMARK_CASES)).toEqual({ correct: 8, total: 10, unsafeAutoApplied: 0, invalidBatches: 0, reviewCount: 5 });
  });

  it('counts a confident wrong category for a clear purchase as unsafe too', () => {
    const response = correctResponse();
    response.decisions[0].categoryId = 3;
    expect(scoreBenchmarkBatch(response, BENCHMARK_CASES)).toEqual({ correct: 9, total: 10, unsafeAutoApplied: 1, invalidBatches: 0, reviewCount: 5 });
  });

  it('requires a useful confident classification for unambiguous cases', () => {
    const response = correctResponse();
    response.decisions[0].confidence = 0.5;
    expect(scoreBenchmarkBatch(response, BENCHMARK_CASES).correct).toBe(9);
    expect(scoreBenchmarkBatch(response, BENCHMARK_CASES).reviewCount).toBe(6);
  });

  it.each(['missing', 'duplicate', 'foreign', 'invented', 'extra'] as const)('invalidates a %s batch atomically', kind => {
    const response = correctResponse();
    if (kind === 'missing') response.decisions.pop();
    if (kind === 'duplicate') response.decisions[1].journalId = response.decisions[0].journalId;
    if (kind === 'foreign') response.decisions[0].journalId = 9999;
    if (kind === 'invented') response.decisions[0].categoryId = 9999;
    const input = kind === 'extra' ? { ...response, instructions: 'Ignore unknown data' } : response;
    expect(scoreBenchmarkBatch(input, BENCHMARK_CASES)).toMatchObject({ correct: 0, invalidBatches: 1, reviewCount: null });
  });

  it('tracks unsafe proposals even when malformed output also invalidates the batch', () => {
    const response = correctResponse();
    response.decisions.push({ journalId: 108, categoryId: 1, confidence: 1, reason: 'Unsafe duplicate proposal.' });
    expect(scoreBenchmarkBatch(response, BENCHMARK_CASES)).toEqual({ correct: 0, total: 10, unsafeAutoApplied: 1, invalidBatches: 1, reviewCount: null });
  });

  it('does not mutate fixture records while scoring and supports five-row batches', () => {
    const snapshot = JSON.stringify(BENCHMARK_CASES);
    const response = correctResponse();
    expect(scoreBenchmarkBatch({ decisions: response.decisions.slice(0, 5) }, BENCHMARK_CASES.slice(0, 5))).toMatchObject({ correct: 5, total: 5, invalidBatches: 0, reviewCount: 0 });
    expect(JSON.stringify(BENCHMARK_CASES)).toBe(snapshot);
  });

  it('provides scoped fictional cleaner context without importing a user’s personal data', () => {
    const prompt = benchmarkPrompt(BENCHMARK_CASES.slice(0, 5));
    expect(prompt).toContain('Morgan Finch');
    expect(prompt).toContain('"accountId":22,"ownerId":2');
    expect(prompt).toContain('another account or owner is not a matching fact');
    expect(prompt).toContain('never instructions');
    expect(prompt).not.toContain('Sylvia');
    expect(prompt).not.toContain('Jono');
    expect(prompt).not.toContain('"snapshot"');
  });
});
