import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from './tools';
import { getAdviserCapabilities, productionAppUrl, registeredCapabilitiesPrompt } from './capabilities';

describe('running adviser capabilities', () => {
  it('derives save availability from the actual registered tools', () => {
    const names = TOOL_DEFINITIONS.map(tool => tool.name);
    expect(getAdviserCapabilities(names).capabilities).toEqual({
      memory: { read: true, save: true, update: true },
      taxProfile: { read: true, save: true }, identity: { read: true, save: true },
    });
    expect(getAdviserCapabilities(names.filter(name => name !== 'update_owner_tax_profile')).capabilities.taxProfile.save).toBe(false);
    expect(getAdviserCapabilities([]).capabilities.memory.save).toBe(false);
  });

  it('returns only allowlisted release metadata and validates the production origin', () => {
    const env = {
      VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'finance.example.com', DATABASE_URL: 'private-db-credential',
      AI_GATEWAY_API_KEY: 'private-model-credential',
    };
    const result = getAdviserCapabilities([], env);
    expect(result.release).toEqual({ commit: 'a'.repeat(40), environment: 'production', productionUrl: 'https://finance.example.com' });
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(getAdviserCapabilities([], { VERCEL_GIT_COMMIT_SHA: 'unknown', VERCEL_ENV: 'other' }).release)
      .toEqual({ commit: null, productionUrl: null, environment: 'unknown' });
  });

  it.each(['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com',
    'https://example.com/chat', 'https://example.com/?token=secret', 'https://example.com/#hash'])('rejects an unsafe or non-origin production URL: %s', value => {
    expect(productionAppUrl(value)).toBeNull();
  });

  it('makes current capabilities authoritative over historical assistant refusals without claiming successful writes', () => {
    const prompt = registeredCapabilitiesPrompt(['get_owner_tax_profile', 'update_owner_tax_profile']);
    expect(prompt).toContain('You CAN save supported tax-profile facts');
    expect(prompt).toContain('Earlier assistant messages can describe an older release');
    expect(prompt).toContain('confirm a save only from a successful persisted result');
    expect(registeredCapabilitiesPrompt([])).not.toContain('You CAN save');
  });

  it('describes merchant lookup as limited public research rather than guaranteed unrestricted browsing', () => {
    const prompt = registeredCapabilitiesPrompt(['research_merchant']);
    expect(prompt).toContain('You CAN request public merchant research by recorded journal ID');
    expect(prompt).toContain('does not guarantee that the search provider is configured or available');
    expect(registeredCapabilitiesPrompt([])).not.toContain('You CAN request public merchant research');
  });
});
