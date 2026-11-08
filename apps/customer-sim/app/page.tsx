import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { tenantIdSchema, type ChannelThreadResponse } from '@mini-inbox/contracts';
import { Composer } from '../components/Composer';
import { RefreshButton } from '../components/RefreshButton';
import { api } from '../lib/api';
import { CUSTOMERS, customerByNumber } from '../lib/customers';

const SENDER_KEY = { CUSTOMER: 'you', AI: 'assistant', HUMAN: 'staff', SYSTEM: 'notice' } as const;

/**
 * DEV ONLY customer simulator: pick one of three test customers and a tenant, send messages, read the replies.
 * Nothing is stored here: the thread is read from the API on every render.
 */
export default async function SimulatorPage({ searchParams }: { searchParams: Promise<{ customer?: string; tenant?: string }> }) {
  const t = await getTranslations('Sim');
  const format = await getFormatter();
  const params = await searchParams;
  const customer = customerByNumber(params.customer);
  const tenants = await api.tenants().catch(() => null);
  if (!tenants) return <p className="pane error">{t('unavailable')}</p>;
  if (tenants.length === 0) return <p className="pane muted">{t('noTenants')}</p>;
  const requested = tenantIdSchema.safeParse(params.tenant);
  const tenant = tenants.find((x) => requested.success && x.id === requested.data) ?? tenants[0]!;
  const thread: ChannelThreadResponse | null = await api.thread(tenant.id, customer.address).catch(() => null);
  const href = (c: number, tenantId: string) => `/?${new URLSearchParams({ customer: String(c), tenant: tenantId })}`;

  return (
    <div className="sim">
      <nav className="pane picker" aria-label={t('customers')}>
        <h2>{t('customers')}</h2>
        <ul className="choices">
          {CUSTOMERS.map((c) => (
            <li key={c.number}>
              <Link href={href(c.number, tenant.id)} aria-current={c.number === customer.number ? 'page' : undefined} className="choice">
                <span>{t('customer', { number: c.number })}</span>
                <bdi className="muted small" dir="ltr">
                  {c.address}
                </bdi>
              </Link>
            </li>
          ))}
        </ul>
        <h2>{t('tenants')}</h2>
        <ul className="choices">
          {tenants.map((x) => (
            <li key={x.id}>
              <Link href={href(customer.number, x.id)} aria-current={x.id === tenant.id ? 'page' : undefined} className="choice">
                <bdi>{x.name}</bdi>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="pane chat" aria-labelledby="chat-title">
        <div className="pane-header">
          <h1 id="chat-title">
            {t('chatTitle', { customer: customer.number })} <bdi>{tenant.name}</bdi>
          </h1>
          <RefreshButton />
        </div>
        {thread?.mode === 'HUMAN' && <p className="mode-hint small">{t('staffReplying')}</p>}
        {thread === null && <p className="error">{t('threadUnavailable')}</p>}
        {thread?.messages.length === 0 && <p className="muted">{t('empty')}</p>}
        <ol className="messages">
          {thread?.messages.map((m) => (
            <li key={m.id} className={`bubble sender-${m.senderType}`}>
              <div className="meta small">
                <strong>{t(`sender.${SENDER_KEY[m.senderType]}`)}</strong>{' '}
                <time dateTime={m.createdAt} className="muted">
                  {format.dateTime(new Date(m.createdAt), { dateStyle: 'short', timeStyle: 'short' })}
                </time>
              </div>
              <p dir="auto">{m.body}</p>
            </li>
          ))}
        </ol>
        <Composer key={`${customer.number}-${tenant.id}`} customer={customer.number} tenant={tenant.id} />
        <p className="muted small">{t('refreshHint')}</p>
      </section>
    </div>
  );
}
