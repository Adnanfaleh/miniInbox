'use client';

import { useTranslations } from 'next-intl';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('App.error');
  return (
    <section className="pane narrow" role="alert">
      <h1>{t('title')}</h1>
      <button type="button" onClick={reset}>
        {t('retry')}
      </button>
    </section>
  );
}
