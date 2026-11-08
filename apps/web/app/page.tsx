import { getTranslations } from 'next-intl/server';
import type { ConversationDetailResponse } from '@mini-inbox/contracts';
import { z } from 'zod';
import { ConversationList } from '../components/ConversationList';
import { CustomerLabel } from '../components/CustomerLabel';
import { ModeControls } from '../components/ModeControls';
import { RefreshButton } from '../components/RefreshButton';
import { ReplyBox } from '../components/ReplyBox';
import { Thread } from '../components/Thread';
import { ApiError, api } from '../lib/api';
import { requireTenant } from '../lib/session';

/** Inbox: conversation list (start side) and the selected thread (end side). Manual refresh only. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireTenant();
  const t = await getTranslations('Inbox');
  const requested = (await searchParams).c;
  const selectedId = z.uuid().safeParse(requested).success ? requested! : null;

  const list = await api.conversations();
  let detail: ConversationDetailResponse | null = null;
  let notFound = Boolean(requested) && !selectedId;
  if (selectedId) {
    try {
      detail = await api.conversation(selectedId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) notFound = true;
      else throw err;
    }
  }

  return (
    <div className="inbox">
      <section className="pane list-pane" aria-labelledby="conversations-title">
        <div className="pane-header">
          <h1 id="conversations-title">{t('conversations')}</h1>
          <RefreshButton />
        </div>
        <ConversationList items={list.items} selectedId={selectedId} />
      </section>
      <section className="pane thread-pane" aria-live="polite">
        {notFound && <p className="muted">{t('notFound')}</p>}
        {!detail && !notFound && <p className="muted">{t('noSelection')}</p>}
        {detail && (
          <>
            <div className="pane-header">
              <h2>
                <CustomerLabel label={detail.conversation.customer.label} />
              </h2>
              <ModeControls conversationId={detail.conversation.id} mode={detail.conversation.mode} />
            </div>
            <Thread detail={detail} />
            {detail.conversation.mode === 'HUMAN' ? (
              <ReplyBox conversationId={detail.conversation.id} />
            ) : (
              <p className="muted small">{t('replyNeedsTakeover')}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
