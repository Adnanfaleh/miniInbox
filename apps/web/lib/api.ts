import 'server-only';
import { loadEnv, webEnvSchema } from '@mini-inbox/config';
import {
  TENANT_HEADER,
  type ConversationDetailResponse,
  type ConversationListResponse,
  type ConversationModeState,
  type ManualReplyCreated,
  type PersonaInput,
  type PersonaResponse,
} from '@mini-inbox/contracts';
import { currentTenantId } from './tenant';

const env = loadEnv(webEnvSchema);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API responded ${status}`);
  }
}

/**
 * Server-side calls to the Mini Inbox API. The tenant header is added here from the httpOnly cookie, and
 * responses are never cached (each holds one tenant's data).
 */
async function call<T>(path: string, init: RequestInit = {}, { withTenant = true } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (withTenant) {
    const tenantId = await currentTenantId();
    if (!tenantId) throw new ApiError(401, null);
    headers.set(TENANT_HEADER, tenantId);
  }
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(`${env.API_BASE_URL}${path}`, { ...init, headers, cache: 'no-store' });
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  /** DEV STAND-IN: tenant picker list (no tenant header). */
  devTenants: () => call<{ id: string; name: string }[]>('/dev/tenants', {}, { withTenant: false }),
  conversations: (cursor?: string) => call<ConversationListResponse>(`/conversations?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  conversation: (id: string) => call<ConversationDetailResponse>(`/conversations/${id}?limit=100`),
  takeover: (id: string) => call<ConversationModeState>(`/conversations/${id}/takeover`, { method: 'POST' }),
  returnToAi: (id: string) => call<ConversationModeState>(`/conversations/${id}/return-to-ai`, { method: 'POST' }),
  reply: (id: string, text: string) => call<ManualReplyCreated>(`/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
  persona: () => call<PersonaResponse>('/persona'),
  savePersona: (input: PersonaInput) => call<PersonaResponse>('/persona', { method: 'PUT', body: JSON.stringify(input) }),
};
