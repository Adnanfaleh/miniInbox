import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { DevBanner } from '../components/DevBanner';
import { Header } from '../components/Header';
import { api } from '../lib/api';
import { directionOf, isLocale } from '../lib/locale';
import { currentSession } from '../lib/tenant';
import '@mini-inbox/ui/theme.css';
import './globals.css';

export async function generateMetadata() {
  const t = await getTranslations('App');
  return { title: t('title') };
}

/** DEV STAND-IN: the role from the signed session; the tenant's display name from the development tenant list. */
async function headerState() {
  const session = await currentSession();
  if (!session?.tenantId) return { role: session?.role ?? null, tenantName: null };
  const list = await api.devTenants().catch(() => []);
  return { role: session.role, tenantName: list.find((t) => t.id === session.tenantId)?.name ?? null };
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
          <Header {...await headerState()} />
          <main className="main">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
