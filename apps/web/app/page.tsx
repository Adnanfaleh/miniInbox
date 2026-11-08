import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ConversationDetailResponse, ConversationStatus } from '@mini-inbox/contracts';
import { z } from 'zod';
import { ConversationList, inboxHref } from '../components/ConversationList';
import { CustomerLabel } from '../components/CustomerLabel';
import { ModeControls } from '../components/ModeControls';
import { RefreshButton } from '../components/RefreshButton';
import { ReplyBox } from '../components/ReplyBox';
import { Thread } from '../components/Thread';
import { ApiError, api } from '../lib/api';
import { requireTenant } from '../lib/session';

/**
 * Inbox: Open / Closed tabs and the conversation list (start side), the selected thread (end side).
 * Manual refresh only. A closed conversation is read-only until the customer writes again.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string; status?: string }> }) {
  await requireTenant();
  const t = await getTranslations('Inbox');
  const params = await searchParams;
  const status: ConversationStatus = params.status === 'closed' ? 'CLOSED' : 'OPEN';
  const requested = params.c;
  const selectedId = z.uuid().safeParse(requested).success ? requested! : null;

  const list = await api.conversations(status);
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
  const closed = detail?.conversation.status === 'CLOSED';

  return (
    <div className="inbox">
      <section className="pane list-pane" aria-labelledby="conversations-title">
        <div className="pane-header">
          <h1 id="conversations-title">{t('conversations')}</h1>
          <RefreshButton />
        </div>
        <nav className="tabs" aria-label={t('tabs.label')}>
          {(['OPEN', 'CLOSED'] as const).map((s) => (
            <Link key={s} href={inboxHref(s)} className="tab" aria-current={s === status ? 'page' : undefined}>
              {t(`tabs.${s}`)}
            </Link>
          ))}
        </nav>
        <ConversationList items={list.items} selectedId={selectedId} status={status} />
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
              <ModeControls conversationId={detail.conversation.id} mode={detail.conversation.mode} status={detail.conversation.status} />
            </div>
            <Thread detail={detail} />
            {closed ? (
              <p className="muted small">{t('closedNote')}</p>
            ) : detail.conversation.mode === 'HUMAN' ? (
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
