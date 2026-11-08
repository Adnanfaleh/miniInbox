'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { sendMessage, type SendResult } from '../lib/actions';

/** Message box. Sends through the webhook (server action); the reply arrives later and shows after Refresh. */
export function Composer({ customer, tenant }: { customer: number; tenant: string }) {
  const t = useTranslations('Sim');
  const [state, action, pending] = useActionState<SendResult | null, FormData>(sendMessage, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="composer">
      <input type="hidden" name="customer" value={customer} />
      <input type="hidden" name="tenant" value={tenant} />
      <label htmlFor="text" className="visually-hidden">
        {t('messageLabel')}
      </label>
      <textarea id="text" name="text" rows={2} maxLength={4000} required dir="auto" placeholder={t('placeholder')} />
      <div className="row">
        {state?.ok && (
          <span role="status" className="muted small">
            {t('sent')}
          </span>
        )}
        {state && !state.ok && (
          <span role="alert" className="error small">
            {t(state.error === 'invalid' ? 'invalid' : 'failed')}
          </span>
        )}
        <button type="submit" className="primary" disabled={pending} aria-busy={pending}>
          {t('send')}
        </button>
      </div>
    </form>
  );
}
