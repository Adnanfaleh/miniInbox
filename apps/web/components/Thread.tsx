import type { ConversationDetailResponse, LifecycleMarker, MessageDto } from '@mini-inbox/contracts';
import { getFormatter, getTranslations } from 'next-intl/server';

type Entry = { kind: 'message'; at: string; message: MessageDto } | { kind: 'marker'; at: string; marker: LifecycleMarker };

/**
 * Messages oldest first. Customer, AI, staff and system messages are visually distinct.
 * "Conversation closed / reopened" dividers are drawn between them for staff only (the customer is not told).
 */
export async function Thread({ detail }: { detail: ConversationDetailResponse }) {
  const [t, format] = [await getTranslations('Inbox'), await getFormatter()];
  if (detail.messages.length === 0) return <p className="muted">{t('noMessages')}</p>;
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  // Only markers inside the shown page of messages (older history may be hidden).
  const first = detail.messages[0]!.createdAt;
  const entries: Entry[] = [
    ...detail.messages.map((m) => ({ kind: 'message' as const, at: m.createdAt, message: m })),
    ...detail.lifecycle.filter((l) => l.at >= first).map((l) => ({ kind: 'marker' as const, at: l.at, marker: l })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="thread">
      {detail.olderCursor && <li className="muted small">{t('olderHidden')}</li>}
      {entries.map((e) =>
        e.kind === 'marker' ? (
          <li key={`${e.marker.type}-${e.at}`} className="lifecycle-divider small muted" role="separator">
            <span>
              {t(`lifecycle.divider.${e.marker.type}`)} · <time dateTime={e.at}>{when(e.at)}</time>
            </span>
          </li>
        ) : (
          <li key={e.message.id} className={`message sender-${e.message.senderType}`}>
            <div className="message-meta small">
              <span className="sender">{t(`sender.${e.message.senderType}`)}</span>
              <time dateTime={e.message.createdAt}>{when(e.message.createdAt)}</time>
              {e.message.replyStatus && <span className={`badge status-${e.message.replyStatus}`}>{t(`status.${e.message.replyStatus}`)}</span>}
              {e.message.complexity && <span className="badge">{t(`complexity.${e.message.complexity}`)}</span>}
              {e.message.intent && <span className="badge">{t(`intent.${e.message.intent}`)}</span>}
            </div>
            <p className="message-body" dir="auto">
              {e.message.body}
            </p>
          </li>
        ),
      )}
    </ol>
  );
}
