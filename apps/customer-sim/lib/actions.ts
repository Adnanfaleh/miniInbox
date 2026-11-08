'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { inboundMessageSchema, tenantIdSchema } from '@mini-inbox/contracts';
import { api } from './api';
import { customerNumberSchema, CUSTOMERS } from './customers';
import { LOCALE_COOKIE, isLocale } from './locale';

export type SendResult = { ok: true } | { ok: false; error: 'invalid' | 'failed' };

/**
 * Server actions are public endpoints: every input is validated. The browser sends the customer's number (1–3) and the
 * chosen tenant; the address is looked up here. The tenant must be one the API lists; the webhook checks it again.
 */
export async function sendMessage(_prev: SendResult | null, formData: FormData): Promise<SendResult> {
  const customer = customerNumberSchema.safeParse(formData.get('customer'));
  const tenantId = tenantIdSchema.safeParse(formData.get('tenant'));
  const text = inboundMessageSchema.shape.text.safeParse(formData.get('text'));
  if (!customer.success || !tenantId.success || !text.success) return { ok: false, error: 'invalid' };
  try {
    const tenants = await api.tenants();
    if (!tenants.some((t) => t.id === tenantId.data)) return { ok: false, error: 'invalid' };
    await api.send(tenantId.data, CUSTOMERS[customer.data - 1]!.address, text.data);
  } catch {
    return { ok: false, error: 'failed' };
  }
  revalidatePath('/');
  return { ok: true };
}

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get('locale');
  if (isLocale(locale)) (await cookies()).set(LOCALE_COOKIE, locale, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}
