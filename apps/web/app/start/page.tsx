import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { enterAsCreator } from '../../lib/actions';
import { requireNoSession } from '../../lib/session';

/** DEV STAND-IN, NOT AUTHENTICATION: the first page. Choose the Inboxes creator role or one tenant. */
export default async function StartPage() {
  await requireNoSession();
  const t = await getTranslations('Start');
  return (
    <section className="pane narrow">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      <ul className="tenant-list">
        <li>
          <form action={enterAsCreator}>
            <button type="submit" className="tenant-choice">
              <span>{t('creator')}</span>
              <span className="muted small">{t('creatorHint')}</span>
            </button>
          </form>
        </li>
        <li>
          <Link href="/enter-tenant" className="tenant-choice button-link">
            <span>{t('tenant')}</span>
            <span className="muted small">{t('tenantHint')}</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
