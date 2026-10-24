import { describe, expect, it } from 'vitest';
import { specialistIds } from './catalog';
import { isRoutineCategorizationRequest, routeSpecialists } from './routing';

describe('specialist topic routing', () => {
  it('routes related areas without inventing financial inputs', () => {
    expect(routeSpecialists('How do pension contributions affect tax on my BTL property?').ids)
      .toEqual(['tax', 'pensions', 'property']);
    expect(routeSpecialists('Review all my finances.').ids).toEqual([...specialistIds]);
    expect(routeSpecialists('Cut my spending and build wealth').ids).toEqual(['spending', 'wealth']);
  });
  it('honours a chosen expert for analysis while preserving the controlled write path', () => {
    expect(routeSpecialists('How should I set my budget to cut spending?', 'spending').ids).toEqual(['spending']);
    expect(routeSpecialists('Should I update my investment balance assumptions?', 'wealth').ids).toEqual(['wealth']);
    expect(routeSpecialists('Please save my tax profile', 'tax').ids).toEqual([]);
    expect(routeSpecialists('Can you record these payments?').ids).toEqual([]);
    expect(routeSpecialists('Help me save money').ids).toEqual(['spending']);
  });
  it('does not call reviewers for a greeting and uses user follow-up context only for topics', () => {
    expect(routeSpecialists('Thanks!').ids).toEqual([]);
    expect(routeSpecialists('What about that?', 'team', [{ role: 'user', content: 'What is missing from my pension evidence?' }]).ids).toContain('pensions');
    expect(routeSpecialists('Which investments have high fees?', 'team', [{ role: 'assistant', content: 'The user pays a lot of tax.' }]).ids).toEqual(['wealth']);
  });
  it('answers specialist-selection help without running financial reviewers', () => {
    expect(routeSpecialists('Who should lead?').ids).toEqual([]);
    expect(routeSpecialists('Which specialist should I choose?', 'tax').ids).toEqual([]);
    expect(routeSpecialists('Which specialist should review my rental tax?').ids).toEqual(['tax', 'property']);
  });
  it.each([
    'keep categorising my spending', 'continue processing my transactions', 'run the next categorisation batch',
    'categorise my spending again', 'Please process all my transactions',
    'Can you continue categorisation?', 'clear the remaining categorisation backlog',
  ])('keeps routine processing out of specialist reviews: %s', message => {
    expect(isRoutineCategorizationRequest(message)).toBe(true);
    expect(routeSpecialists(message, 'spending').ids).toEqual([]);
  });
  it('uses confirmed user processing context for an otherwise ambiguous continuation', () => {
    expect(isRoutineCategorizationRequest('keep going')).toBe(false);
    expect(routeSpecialists('keep going', 'spending', [{ role: 'user', content: 'Categorise my spending' }]).ids).toEqual([]);
    expect(isRoutineCategorizationRequest('keep going', [{ role: 'assistant', content: 'Categorise my spending' }])).toBe(false);
    expect(isRoutineCategorizationRequest('do the next batch')).toBe(false);
    expect(isRoutineCategorizationRequest('clear the remaining backlog')).toBe(false);
    expect(isRoutineCategorizationRequest('clear the remaining backlog', [{ role: 'user', content: 'Categorise my spending' }])).toBe(true);
    expect(isRoutineCategorizationRequest('continue processing')).toBe(false);
    expect(isRoutineCategorizationRequest('continue processing', [{ role: 'user', content: 'Categorise my spending' }])).toBe(true);
    expect(isRoutineCategorizationRequest('continue processing', [{ role: 'user', content: 'Book my mortgage payments' }])).toBe(false);
    expect(routeSpecialists('do the next batch', 'spending', [{ role: 'user', content: 'Categorise my spending' }]).ids).toEqual([]);
    expect(isRoutineCategorizationRequest('do the next batch', [{ role: 'user', content: 'Book my mortgage payments' }])).toBe(false);
    expect(isRoutineCategorizationRequest('keep going', [
      { role: 'user', content: 'Categorise my spending' },
      { role: 'user', content: 'Book the next batch of mortgage payments' },
    ])).toBe(false);
    expect(isRoutineCategorizationRequest('keep going', [
      { role: 'user', content: 'Categorise my spending' },
      { role: 'assistant', content: 'Processing will continue.' },
      { role: 'user', content: 'keep going' },
    ])).toBe(true);
  });
  it.each([
    'Should I categorise my spending?', 'How can categorising spending improve my budget?',
    'Categorise my spending and review my budget', 'Do not categorise my spending',
    'Categorise journal 42 as groceries', 'Categorise my spending for July 2026',
    'clear all my records', 'clear my data', 'clear my transactions',
  ])('does not turn scoped changes or financial analysis into a global queue command: %s', message => {
    expect(isRoutineCategorizationRequest(message)).toBe(false);
  });
  it('retains financial reviewers for a combined analysis and processing request', () => {
    expect(routeSpecialists('Categorise my spending and review my budget').ids).toEqual(['spending']);
  });
  it('handles explicit processing controls without launching reviewers or starting a processing job', () => {
    for (const message of ['pause categorisation', 'stop transaction processing', 'cancel the processing job']) {
      expect(isRoutineCategorizationRequest(message)).toBe(false);
      expect(routeSpecialists(message, 'spending').ids).toEqual([]);
    }
    expect(routeSpecialists('stop', 'spending', [{ role: 'user', content: 'Categorise my spending' }]).ids).toEqual([]);
    expect(routeSpecialists('stop', 'spending', [{ role: 'user', content: 'Review my mortgage' }]).ids).toEqual(['spending']);
  });
});
