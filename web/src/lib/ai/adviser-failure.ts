import { z } from 'zod';

// This module is shared with the browser. Never include a provider error body,
// prompt, request URL, tool argument or financial record in this contract.
export const adviserFailureCodes = [
  'request_timeout', 'provider_rate_limit', 'provider_auth', 'provider_unavailable',
  'provider_rejected', 'invalid_response', 'no_answer', 'response_limit',
  'history_unavailable', 'request_cancelled', 'review_failed',
] as const;
export type AdviserFailureCode = typeof adviserFailureCodes[number];
export const adviserFailureDetailsSchema = z.object({
  code: z.enum(adviserFailureCodes),
  requestId: z.uuid(),
  retryable: z.boolean(),
  recordChanges: z.enum(['none', 'possible']),
  historySaved: z.boolean(),
  generationCompleted: z.boolean(),
}).strict();
export type AdviserFailureDetails = z.infer<typeof adviserFailureDetailsSchema>;

/** Runtime failures carry a bounded code while retaining a private cause. */
export class AdviserFailureError extends Error {
  readonly code: AdviserFailureCode;
  constructor(code: AdviserFailureCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'AdviserFailureError';
    this.code = code;
  }
}

export interface ClassifiedAdviserFailure {
  code: AdviserFailureCode;
  retryable: boolean;
  statusCode?: number;
}
const transient = new Set<AdviserFailureCode>(['request_timeout', 'provider_rate_limit', 'provider_unavailable']);
const providerErrorNames = new Set([
  'AI_APICallError', 'GatewayAuthenticationError', 'GatewayInternalServerError',
  'GatewayInvalidRequestError', 'GatewayModelNotFoundError', 'GatewayRateLimitError',
  'GatewayResponseError', 'GatewayTimeoutError',
]);

/**
 * Inspect only trusted error structure and whitelisted values, never message
 * substrings. Provider/database messages can echo credentials or user data.
 */
export function classifyAdviserFailure(error: unknown, stage: 'generation' | 'history' | 'preparation' = 'generation'): ClassifiedAdviserFailure {
  if (stage !== 'generation') return { code: 'history_unavailable', retryable: false };
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    if (current instanceof AdviserFailureError) {
      return { code: current.code, retryable: transient.has(current.code) };
    }
    const candidate = current as Error & { statusCode?: unknown; code?: unknown };
    const statusCode = providerErrorNames.has(current.name) && typeof candidate.statusCode === 'number' && Number.isInteger(candidate.statusCode)
      && candidate.statusCode >= 100 && candidate.statusCode <= 599 ? candidate.statusCode : undefined;
    let code: AdviserFailureCode | undefined;
    if (statusCode === 408 || current.name === 'GatewayTimeoutError') code = 'request_timeout';
    else if (statusCode === 429) code = 'provider_rate_limit';
    else if (statusCode === 401 || statusCode === 403 || current.name === 'AI_LoadAPIKeyError') code = 'provider_auth';
    else if (statusCode !== undefined && statusCode >= 500) code = 'provider_unavailable';
    else if (statusCode !== undefined && statusCode >= 400) code = 'provider_rejected';
    else if (current.name === 'TimeoutError' || candidate.code === 'ETIMEDOUT') code = 'request_timeout';
    else if (current.name === 'AbortError') code = 'request_cancelled';
    else if (['AI_InvalidResponseDataError', 'AI_TypeValidationError', 'AI_JSONParseError', 'ZodError'].includes(current.name)) code = 'invalid_response';
    else if (current.name === 'AI_NoContentGeneratedError') code = 'no_answer';
    else if (typeof candidate.code === 'string' && ['ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED'].includes(candidate.code)) code = 'provider_unavailable';
    if (code) return { code, retryable: transient.has(code), ...(statusCode === undefined ? {} : { statusCode }) };
    current = current.cause;
  }
  return { code: 'review_failed', retryable: false };
}

export function adviserFailureMessage(details: Pick<AdviserFailureDetails, 'code' | 'recordChanges' | 'generationCompleted'>): string {
  const messages: Record<AdviserFailureCode, string> = {
    request_timeout: 'This review reached its time limit. Any answer or specialist notes shown are incomplete.',
    provider_rate_limit: 'The AI service is temporarily limiting requests. This review stopped before completion.',
    provider_auth: 'The adviser could not connect because its AI provider rejected its credentials or access.',
    provider_unavailable: 'The AI service was unavailable while this review was running.',
    provider_rejected: 'The AI provider rejected this review request, so the review could not be completed.',
    invalid_response: 'The adviser received an invalid response and stopped the review.',
    no_answer: 'The adviser did not return an answer. Any specialist notes shown are incomplete.',
    response_limit: 'The adviser reached the response limit before finishing the review.',
    history_unavailable: details.generationCompleted
      ? 'Your answer finished, but saving it to chat history could not be confirmed. Keep the answer shown here before leaving this page.'
      : 'Saving this review to chat history could not be confirmed. Keep any answer shown here before leaving this page.',
    request_cancelled: 'This review was stopped. Any answer or specialist notes shown are incomplete.',
    review_failed: 'The adviser stopped unexpectedly. Any answer or specialist notes shown are incomplete.',
  };
  return messages[details.code] + (details.recordChanges === 'possible'
    ? ' A record-changing action had already started; check your records before retrying it.' : '');
}
