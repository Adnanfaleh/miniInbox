import 'server-only';
import { randomUUID } from 'node:crypto';
import { customerSimEnvSchema, loadEnv } from '@mini-inbox/config';
import type { ChannelThreadResponse, InboundMessageAccepted } from '@mini-inbox/contracts';

const env = loadEnv(customerSimEnvSchema);

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API responded ${status}`);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(`${env.API_BASE_URL}${path}`, { ...init, headers, cache: 'no-store' });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

/**
 * DEV ONLY. The simulator plays the messaging channel: it sends through the public webhook and reads replies through
 * the development channel endpoint. It never sends `x-tenant-id` and never calls the tenant dashboard API.
 */
export const api = {
  tenants: () => call<{ id: string; name: string }[]>('/dev/tenants'),
  thread: (tenantId: string, from: string) =>
    call<ChannelThreadResponse>(`/dev/channel/${tenantId}/messages?${new URLSearchParams({ from })}`),
  send: (tenantId: string, from: string, text: string) =>
    call<InboundMessageAccepted>(`/webhook/${tenantId}/message`, {
      method: 'POST',
      body: JSON.stringify({ externalId: `sim-${randomUUID()}`, from, text }),
    }),
};
