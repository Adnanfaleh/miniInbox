'use client';

import type { ConversationMode } from '@mini-inbox/contracts';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { returnToAi, takeover, type ActionResult } from '../lib/actions';

/** Take over (AI mode) or return to AI (human mode). The server re-checks the mode under a row lock. */
export function ModeControls({ conversationId, mode }: { conversationId: string; mode: ConversationMode }) {
  const t = useTranslations('Inbox');
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = () =>
    start(async () => {
      setResult(await (mode === 'AI' ? takeover(conversationId) : returnToAi(conversationId)));
    });
  return (
    <div className="mode-controls">
      <span className={`badge mode-${mode}`}>{t(`mode.${mode}`)}</span>
      <button type="button" onClick={run} disabled={pending} aria-busy={pending} className="primary">
        {mode === 'AI' ? t('takeover') : t('returnToAi')}
      </button>
      {result && !result.ok && (
        <span role="alert" className="error">
          {result.error === 'busy' ? t('busy') : t('actionFailed')}
        </span>
      )}
    </div>
  );
}
