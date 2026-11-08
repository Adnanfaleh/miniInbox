'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { sendReply, type ActionResult } from '../lib/actions';

/** Manual staff reply, shown only in human mode. The API refuses replies in AI mode (409). */
export function ReplyBox({ conversationId }: { conversationId: string }) {
  const t = useTranslations('Inbox');
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(sendReply.bind(null, conversationId), null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="reply-box">
      <label htmlFor="reply-text">{t('replyLabel')}</label>
      <textarea id="reply-text" name="text" rows={3} maxLength={4000} required placeholder={t('replyPlaceholder')} dir="auto" />
      <div className="row">
        {state && !state.ok && (
          <span role="alert" className="error">
            {state.error === 'busy' ? t('busy') : t('actionFailed')}
          </span>
        )}
        <button type="submit" disabled={pending} aria-busy={pending} className="primary">
          {t('send')}
        </button>
      </div>
    </form>
  );
}
