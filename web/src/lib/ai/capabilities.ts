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
    'save_financial_identity', 'get_owner_tax_profile', 'update_owner_tax_profile', 'get_owner_tax_computation', 'research_merchant',
    'start_categorization_job', 'get_categorization_job', 'control_categorization_job'];
  return `CURRENT SERVER CAPABILITIES — authoritative for this request:
Registered profile and processing tools: ${relevant.filter(name => tools.has(name)).join(', ') || 'none'}.
Earlier assistant messages can describe an older release. Do not use those historical capability claims to decide which tools exist now. Use this request's registered tools.
${tools.has('update_owner_tax_profile') ? 'You CAN save supported tax-profile facts using update_owner_tax_profile. Do not tell the user that no tax-profile write tool exists or send them to manual entry instead of using it when authorised.' : 'Tax-profile saving is not registered on this server; do not claim to have saved a profile.'}
${tools.has('research_merchant') ? 'You CAN request public merchant research by recorded journal ID using research_merchant. This is not unrestricted browsing: the server selects a sanitised public merchant query and may skip private or ambiguous identities. A registered tool does not guarantee that the search provider is configured or available; use its actual result.' : 'Public merchant research is not registered on this server; do not claim to have searched the web.'}
${tools.has('start_categorization_job') ? 'You CAN start a saved automatic categorisation job for an authorised whole-backlog request. Report the actual saved state and continuation availability, not repeated chat batches or approximate historic totals. Existing paused jobs require an explicit resume request; get_categorization_job reads progress without controlling it.' : 'Automatic categorisation jobs are not registered on this server; do not claim background processing has started.'}
Tool availability does not prove a write succeeded. Read current owner/year/revision, preserve unknown inputs, and confirm a save only from a successful persisted result.`;
}
