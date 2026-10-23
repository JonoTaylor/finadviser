/** Non-sensitive capabilities derived from the tools actually registered on this server. */
export interface AdviserCapabilities {
  version: 1;
  capabilities: {
    memory: { read: boolean; save: boolean; update: boolean };
    taxProfile: { read: boolean; save: boolean };
    identity: { read: boolean; save: boolean };
  };
  release: {
    commit: string | null;
    productionUrl: string | null;
    environment: 'production' | 'preview' | 'development' | 'unknown';
  };
}

export function productionAppUrl(host: string | undefined): string | null {
  if (!host?.trim()) return null;
  try {
    const url = new URL(host.includes('://') ? host : `https://${host}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function getAdviserCapabilities(
  toolNames: Iterable<string>,
  environment: Record<string, string | undefined> = {},
): AdviserCapabilities {
  const tools = new Set(toolNames);
  const deploymentEnvironment = environment.VERCEL_ENV;
  return {
    version: 1,
    capabilities: {
      memory: { read: tools.has('list_memories'), save: tools.has('remember'), update: tools.has('update_memory') },
      taxProfile: { read: tools.has('get_owner_tax_profile'), save: tools.has('update_owner_tax_profile') },
      identity: { read: tools.has('get_financial_identity'), save: tools.has('save_financial_identity') },
    },
    release: {
      commit: /^[a-f0-9]{40}$/i.test(environment.VERCEL_GIT_COMMIT_SHA ?? '') ? environment.VERCEL_GIT_COMMIT_SHA! : null,
      productionUrl: productionAppUrl(environment.VERCEL_PROJECT_PRODUCTION_URL),
      environment: deploymentEnvironment === 'production' || deploymentEnvironment === 'preview' || deploymentEnvironment === 'development'
        ? deploymentEnvironment : environment.NODE_ENV === 'development' ? 'development' : 'unknown',
    },
  };
}

export function registeredCapabilitiesPrompt(toolNames: Iterable<string>): string {
  const tools = new Set(toolNames);
  const relevant = ['list_memories', 'remember', 'update_memory', 'get_financial_identity',
    'save_financial_identity', 'get_owner_tax_profile', 'update_owner_tax_profile', 'get_owner_tax_computation'];
  return `CURRENT SERVER CAPABILITIES — authoritative for this request:
Registered personal-profile tools: ${relevant.filter(name => tools.has(name)).join(', ') || 'none'}.
Earlier assistant messages can describe an older release. Do not use those historical capability claims to decide which tools exist now. Use this request's registered tools.
${tools.has('update_owner_tax_profile') ? 'You CAN save supported tax-profile facts using update_owner_tax_profile. Do not tell the user that no tax-profile write tool exists or send them to manual entry instead of using it when authorised.' : 'Tax-profile saving is not registered on this server; do not claim to have saved a profile.'}
Tool availability does not prove a write succeeded. Read current owner/year/revision, preserve unknown inputs, and confirm a save only from a successful persisted result.`;
}
