import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { directionOf, isLocale } from '../lib/locale';
import '@mini-inbox/ui/theme.css';
import './globals.css';

export async function generateMetadata() {
  const t = await getTranslations('Sim');
  return { title: t('title') };
}

/** `lang` and `dir` follow the active locale. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : 'en';
  const t = await getTranslations('Sim');
  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>
        <NextIntlClientProvider>
          <p className="dev-banner" role="note">
            {t('devBanner')}
          </p>
          <header className="header">
            <strong>{t('title')}</strong>
            <LanguageSwitcher />
          </header>
          <main className="main">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
