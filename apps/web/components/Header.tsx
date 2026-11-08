import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { switchTenant } from '../lib/actions';
import { LanguageSwitcher } from './LanguageSwitcher';

export async function Header({ tenantName }: { tenantName: string | null }) {
  const t = await getTranslations('App');
  return (
    <header className="header">
      <div className="brand">
        <strong>{t('title')}</strong>
        {tenantName && <span className="tenant-name">{tenantName}</span>}
      </div>
      {tenantName && (
        <nav className="nav">
          <Link href="/">{t('nav.inbox')}</Link>
          <Link href="/persona">{t('nav.persona')}</Link>
          <form action={switchTenant}>
            <button type="submit" className="link-button">
              {t('nav.switchTenant')}
            </button>
          </form>
        </nav>
      )}
      <LanguageSwitcher />
    </header>
  );
}
