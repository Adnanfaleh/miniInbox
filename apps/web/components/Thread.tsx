import type { ConversationDetailResponse } from '@mini-inbox/contracts';
import { getFormatter, getTranslations } from 'next-intl/server';

/** Messages oldest first. Customer, AI, staff and system messages are visually distinct. */
export async function Thread({ detail }: { detail: ConversationDetailResponse }) {
  const [t, format] = [await getTranslations('Inbox'), await getFormatter()];
  if (detail.messages.length === 0) return <p className="muted">{t('noMessages')}</p>;
  return (
    <ol className="thread">
      {detail.olderCursor && <li className="muted small">{t('olderHidden')}</li>}
      {detail.messages.map((m) => (
        <li key={m.id} className={`message sender-${m.senderType}`}>
          <div className="message-meta small">
            <span className="sender">{t(`sender.${m.senderType}`)}</span>
            <time dateTime={m.createdAt}>{format.dateTime(new Date(m.createdAt), { dateStyle: 'short', timeStyle: 'short' })}</time>
            {m.replyStatus && <span className={`badge status-${m.replyStatus}`}>{t(`status.${m.replyStatus}`)}</span>}
            {m.complexity && <span className="badge">{t(`complexity.${m.complexity}`)}</span>}
            {m.intent && <span className="badge">{t(`intent.${m.intent}`)}</span>}
          </div>
          <p className="message-body" dir="auto">
            {m.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
