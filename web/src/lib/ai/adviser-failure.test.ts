import { describe, expect, it } from 'vitest';
import { AdviserFailureError, adviserFailureDetailsSchema, adviserFailureMessage, classifyAdviserFailure } from './adviser-failure';

describe('safe adviser failure classification', () => {
  it.each([
    [429, 'provider_rate_limit', true], [401, 'provider_auth', false], [403, 'provider_auth', false],
    [503, 'provider_unavailable', true], [400, 'provider_rejected', false],
  ])('classifies trusted HTTP status %s as %s without message inference', (statusCode, code, retryable) => {
    const provider = Object.assign(new Error('private financial data and API key'), { name: 'AI_APICallError', statusCode });
    expect(classifyAdviserFailure(new Error('private wrapper', { cause: provider }))).toEqual({ code, retryable, statusCode });
  });
  it('does not interpret arbitrary messages, plain objects or forged cause cycles as provider status', () => {
    expect(classifyAdviserFailure(new Error('Rate limit 429 password timeout'))).toEqual({ code: 'review_failed', retryable: false });
    expect(classifyAdviserFailure({ statusCode: 429, message: 'private' })).toEqual({ code: 'review_failed', retryable: false });
    expect(classifyAdviserFailure(Object.assign(new Error('Non-provider DB HTTP failure'), { statusCode: 503 }))).toEqual({ code: 'review_failed', retryable: false });
    const cycle = new Error('private'); cycle.cause = cycle;
    expect(classifyAdviserFailure(cycle)).toEqual({ code: 'review_failed', retryable: false });
  });
  it('preserves explicit deadline and cancellation semantics', () => {
    expect(classifyAdviserFailure(new AdviserFailureError('request_timeout'))).toEqual({ code: 'request_timeout', retryable: true });
    expect(classifyAdviserFailure(new AdviserFailureError('request_cancelled'))).toEqual({ code: 'request_cancelled', retryable: false });
    expect(classifyAdviserFailure(new DOMException('private', 'AbortError')).code).toBe('request_cancelled');
  });
  it('treats persistence as an unconfirmed history save irrespective of private database error detail', () => {
    expect(classifyAdviserFailure(new Error('password connection user'), 'history')).toEqual({ code: 'history_unavailable', retryable: false });
  });
  it('keeps a completed answer distinct from a failed review and adds action warnings only after execution starts', () => {
    const message = adviserFailureMessage({ code: 'history_unavailable', generationCompleted: true, recordChanges: 'none' });
    expect(message).toContain('Your answer finished');
    expect(message).not.toContain('record-changing');
    expect(adviserFailureMessage({ code: 'request_timeout', generationCompleted: false, recordChanges: 'possible' })).toContain('record-changing action had already started');
  });
  it('allows only bounded server codes and non-sensitive structured details', () => {
    const safe = { code: 'provider_rate_limit', requestId: 'd5437ab7-bb7b-47dc-a2ef-1ccfac490d01', retryable: true, recordChanges: 'none', historySaved: true, generationCompleted: false };
    expect(adviserFailureDetailsSchema.safeParse(safe).success).toBe(true);
    expect(adviserFailureDetailsSchema.safeParse({ ...safe, providerMessage: 'private' }).success).toBe(false);
    expect(adviserFailureDetailsSchema.safeParse({ ...safe, requestId: 'raw provider URL' }).success).toBe(false);
  });
});
