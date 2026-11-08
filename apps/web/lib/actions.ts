'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { manualReplySchema, personaInputSchema, tenantIdSchema } from '@mini-inbox/contracts';
import { z } from 'zod';
import { ApiError, api } from './api';
import { LOCALE_COOKIE, isLocale } from './locale';
import { decideCreatorSelect, decideEnterTenant, homeFor } from './session-token';
import { clearSession, currentSession, writeSession } from './tenant';

/**
 * Server actions are public endpoints: every input is validated here, and the tenant is never an argument.
 * It comes from the httpOnly cookie inside `api`, and the API checks that the conversation belongs to it.
 */

const conversationId = z.uuid();
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

export type ActionResult = { ok: true } | { ok: false; error: 'busy' | 'failed' | 'invalid'; issues?: { path: string; message: string }[] };

function failure(err: unknown): ActionResult {
  if (err instanceof ApiError && err.status === 409) return { ok: false, error: 'busy' };
  if (err instanceof ApiError && err.status === 400) {
    const issues = (err.body as { issues?: { path: string; message: string }[] } | null)?.issues ?? [];
    return { ok: false, error: 'invalid', issues };
  }
  return { ok: false, error: 'failed' };
}

/*
 * DEV STAND-IN for staff login. Roles and the tenant lock:
 * - Inboxes creator: may pick and switch between any tenants.
 * - Select tenant: picks one tenant and is locked to it. A direct call to either select action from a locked
 *   session is rejected (no cookie change); only Exit clears the session.
 * The chosen tenant must exist in the API's dev tenant list before it is stored.
 */

async function pickTenant(formData: FormData, decide: typeof decideEnterTenant, invalidPath: string): Promise<void> {
  const parsed = tenantIdSchema.safeParse(formData.get('tenantId'));
  if (!parsed.success) redirect(invalidPath);
  const current = await currentSession();
  const decision = decide(current, parsed.data);
  if (!decision.allowed) {
    // IDs only (CLAUDE.md section 4.3): no names or message content.
    console.warn(
      JSON.stringify({ event: 'tenant_switch_rejected', reason: decision.reason, role: current?.role ?? null, tenantId: current?.tenantId ?? null, requestedTenantId: parsed.data }),
    );
    redirect(homeFor(current));
  }
  const known = await api.devTenants().catch(() => []);
  if (!known.some((t) => t.id === parsed.data)) redirect(invalidPath);
  await writeSession(decision.next);
  redirect('/');
}

/** Start page → "Inboxes creator". Only without a session (Exit first). */
export async function enterAsCreator(): Promise<void> {
  const current = await currentSession();
  if (current) redirect(homeFor(current));
  await writeSession({ role: 'creator' });
  redirect('/select-tenant');
}

/** Start page → "Select tenant" → a tenant button. Locks the session to that tenant. */
export async function enterTenant(formData: FormData): Promise<void> {
  await pickTenant(formData, decideEnterTenant, '/enter-tenant');
}

/** Creator picker → a tenant button. Creator role only. */
export async function creatorSelectTenant(formData: FormData): Promise<void> {
  await pickTenant(formData, decideCreatorSelect, '/select-tenant');
}

/** Leaves the tenant or creator session and returns to the start page. */
export async function exitSession(): Promise<void> {
  await clearSession();
  redirect('/start');
}

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get('locale');
  if (isLocale(locale)) (await cookies()).set(LOCALE_COOKIE, locale, { ...cookieOptions, httpOnly: false, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}

export async function takeover(id: string): Promise<ActionResult> {
  if (!conversationId.safeParse(id).success) return { ok: false, error: 'invalid' };
  try {
    await api.takeover(id);
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/');
  return { ok: true };
}

/** Staff close the conversation (D-047). The API takes the row lock and skips replies still waiting. */
export async function closeConversation(id: string): Promise<ActionResult> {
  if (!conversationId.safeParse(id).success) return { ok: false, error: 'invalid' };
  try {
    await api.close(id);
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/');
  return { ok: true };
}

export async function returnToAi(id: string): Promise<ActionResult> {
  if (!conversationId.safeParse(id).success) return { ok: false, error: 'invalid' };
  try {
    await api.returnToAi(id);
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/');
  return { ok: true };
}

export async function sendReply(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const body = manualReplySchema.safeParse({ text: formData.get('text') });
  if (!conversationId.safeParse(id).success || !body.success) return { ok: false, error: 'invalid' };
  try {
    await api.reply(id, body.data.text);
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/');
  return { ok: true };
}

export async function savePersona(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const parsed = personaInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  try {
    await api.savePersona(parsed.data);
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/persona');
  return { ok: true };
}
