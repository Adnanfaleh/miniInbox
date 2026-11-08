import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { DevBanner } from '../components/DevBanner';
import { Header } from '../components/Header';
import { api } from '../lib/api';
import { directionOf, isLocale } from '../lib/locale';
import { currentTenantId } from '../lib/tenant';
import './globals.css';

export async function generateMetadata() {
  const t = await getTranslations('App');
  return { title: t('title') };
}

/** DEV STAND-IN: the tenant's display name comes from the development tenant list. */
async function tenantName(): Promise<string | null> {
  const id = await currentTenantId();
  if (!id) return null;
  const list = await api.devTenants().catch(() => []);
  return list.find((t) => t.id === id)?.name ?? null;
}

/** `lang` and `dir` follow the active locale, so Arabic renders right-to-left and English left-to-right. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : 'en';
  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>
        <NextIntlClientProvider>
          <DevBanner />
          <Header tenantName={await tenantName()} />
          <main className="main">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
