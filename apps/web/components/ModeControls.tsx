'use client';

import type { ConversationMode, ConversationStatus } from '@mini-inbox/contracts';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { closeConversation, returnToAi, takeover, type ActionResult } from '../lib/actions';

/**
 * Open conversation: take over (AI mode) or return to AI (human mode), plus Close. A closed conversation is
 * read-only: it only shows its badge and reopens when the customer writes again. The server re-checks everything
 * under a row lock.
 */
export function ModeControls({ conversationId, mode, status }: { conversationId: string; mode: ConversationMode; status: ConversationStatus }) {
  const t = useTranslations('Inbox');
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (action: (id: string) => Promise<ActionResult>) =>
    start(async () => {
      setResult(await action(conversationId));
    });

  if (status === 'CLOSED') {
    return (
      <div className="mode-controls">
        <span className="badge status-CLOSED">{t('lifecycle.CLOSED')}</span>
      </div>
    );
  }
  return (
    <div className="mode-controls">
      <span className={`badge mode-${mode}`}>{t(`mode.${mode}`)}</span>
      <button type="button" onClick={() => run(mode === 'AI' ? takeover : returnToAi)} disabled={pending} aria-busy={pending} className="primary">
        {mode === 'AI' ? t('takeover') : t('returnToAi')}
      </button>
      <button type="button" onClick={() => run(closeConversation)} disabled={pending} aria-busy={pending}>
        {t('close')}
      </button>
      {result && !result.ok && (
        <span role="alert" className="error">
          {result.error === 'busy' ? t('busy') : t('actionFailed')}
        </span>
      )}
    </div>
  );
}
