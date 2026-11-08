import Link from 'next/link';
import type { ConversationListItem, ConversationStatus } from '@mini-inbox/contracts';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CustomerLabel } from './CustomerLabel';

/** Href for the inbox, keeping the current tab. Only the tab and the conversation ID are in the URL, never the tenant. */
export const inboxHref = (status: ConversationStatus, conversationId?: string) =>
  `/?${new URLSearchParams({ status: status.toLowerCase(), ...(conversationId ? { c: conversationId } : {}) })}`;

export async function ConversationList({
  items,
  selectedId,
  status,
}: {
  items: ConversationListItem[];
  selectedId: string | null;
  status: ConversationStatus;
}) {
  const [t, format] = [await getTranslations('Inbox'), await getFormatter()];
  if (items.length === 0) return <p className="muted">{t(status === 'OPEN' ? 'empty' : 'emptyClosed')}</p>;
  return (
    <ul className="conversation-list">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={inboxHref(status, c.id)}
            className={c.id === selectedId ? 'conversation selected' : 'conversation'}
            aria-current={c.id === selectedId ? 'true' : undefined}
          >
            <span className="row">
              <CustomerLabel className="customer" label={c.customer.label} />
              {c.status === 'CLOSED' ? (
                <span className="badge status-CLOSED">{t('lifecycle.CLOSED')}</span>
              ) : (
                <span className={`badge mode-${c.mode}`}>{t(`mode.${c.mode}`)}</span>
              )}
            </span>
            {c.lastMessage && (
              <span className="row muted small">
                <span className="preview">
                  {t(`sender.${c.lastMessage.senderType}`)}: <bdi>{c.lastMessage.preview}</bdi>
                </span>
                <time dateTime={c.lastMessage.createdAt}>{format.dateTime(new Date(c.lastMessage.createdAt), { dateStyle: 'short', timeStyle: 'short' })}</time>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
