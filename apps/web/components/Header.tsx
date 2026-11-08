import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { exitSession } from '../lib/actions';
import type { Session } from '../lib/session-token';
import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * Creator mode: tenant name, Creator badge, Inbox, Persona, Switch tenant and Exit.
 * Tenant mode: tenant name, Inbox, Persona and Exit only. There is no way to switch without exiting.
 */
export async function Header({ role, tenantName }: { role: Session['role'] | null; tenantName: string | null }) {
  const t = await getTranslations('App');
  return (
    <header className="header">
      <div className="brand">
        <strong>{t('title')}</strong>
        {tenantName && <bdi className="tenant-name">{tenantName}</bdi>}
        {role === 'creator' && <span className="badge">{t('roles.creator')}</span>}
      </div>
      {role && (
        <nav className="nav">
          {tenantName && <Link href="/">{t('nav.inbox')}</Link>}
          {tenantName && <Link href="/persona">{t('nav.persona')}</Link>}
          {role === 'creator' && tenantName && <Link href="/select-tenant">{t('nav.switchTenant')}</Link>}
          <form action={exitSession}>
            <button type="submit" className="link-button">
              {t('nav.exit')}
            </button>
          </form>
        </nav>
      )}
      <LanguageSwitcher />
    </header>
  );
}
