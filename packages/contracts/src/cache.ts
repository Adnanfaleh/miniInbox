/**
 * Redis keys for tenant data are always namespaced by tenant: `t:{<tenantId>}:<parts>`.
 * The braces are a Redis Cluster hash tag, so one tenant's keys stay on one slot.
 */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  if (!tenantId) throw new Error('tenantKey requires a tenantId');
  return `t:{${tenantId}}:${parts.join(':')}`;
}

/** Persona + knowledge snapshot used by the AI context builder. Cleared when the persona is saved. */
export const personaCacheKey = (tenantId: string): string => tenantKey(tenantId, 'persona');
export const PERSONA_CACHE_TTL_SECONDS = 60;
