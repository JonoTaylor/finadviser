import { describe, expect, it } from 'vitest';
import { specialistIds } from './catalog';
import { routeSpecialists } from './routing';

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
});
