import { getTranslations } from 'next-intl/server';

/** Always visible: the tenant picker is a development stand-in, not authentication. */
export async function DevBanner() {
  const t = await getTranslations('App');
  return (
    <p className="dev-banner" role="note">
      {t('devBanner')}
    </p>
  );
}
