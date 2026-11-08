'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

/** Manual refresh only, like the dashboard: re-reads the thread from the API. */
export function RefreshButton() {
  const t = useTranslations('Sim');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" onClick={() => start(() => router.refresh())} disabled={pending} aria-busy={pending}>
      {t('refresh')}
    </button>
  );
}
