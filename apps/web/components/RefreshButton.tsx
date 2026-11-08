'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

/** Manual refresh only (no live updates in the MVP): re-renders the page with fresh server data. */
export function RefreshButton() {
  const t = useTranslations('Inbox');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" onClick={() => start(() => router.refresh())} disabled={pending} aria-busy={pending}>
      {t('refresh')}
    </button>
  );
}
