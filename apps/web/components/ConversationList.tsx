import Link from 'next/link';
import type { ConversationListItem } from '@mini-inbox/contracts';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CustomerLabel } from './CustomerLabel';

export async function ConversationList({ items, selectedId }: { items: ConversationListItem[]; selectedId: string | null }) {
  const [t, format] = [await getTranslations('Inbox'), await getFormatter()];
  if (items.length === 0) return <p className="muted">{t('empty')}</p>;
  return (
    <ul className="conversation-list">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`/?c=${c.id}`} className={c.id === selectedId ? 'conversation selected' : 'conversation'} aria-current={c.id === selectedId ? 'true' : undefined}>
            <span className="row">
              <CustomerLabel className="customer" label={c.customer.label} />
              <span className={`badge mode-${c.mode}`}>{t(`mode.${c.mode}`)}</span>
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
