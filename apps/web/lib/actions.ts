'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { manualReplySchema, personaInputSchema, tenantIdSchema } from '@mini-inbox/contracts';
import { z } from 'zod';
import { ApiError, api } from './api';
import { LOCALE_COOKIE, isLocale } from './locale';
import { TENANT_COOKIE } from './tenant';

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

/** DEV STAND-IN for staff login: the chosen tenant must exist in the dev picker list before it is stored. */
export async function selectTenant(formData: FormData): Promise<void> {
  const parsed = tenantIdSchema.safeParse(formData.get('tenantId'));
  if (!parsed.success) redirect('/select-tenant');
  const known = await api.devTenants().catch(() => []);
  if (!known.some((t) => t.id === parsed.data)) redirect('/select-tenant');
  (await cookies()).set(TENANT_COOKIE, parsed.data, cookieOptions);
  redirect('/');
}

export async function switchTenant(): Promise<void> {
  (await cookies()).delete(TENANT_COOKIE);
  redirect('/select-tenant');
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
