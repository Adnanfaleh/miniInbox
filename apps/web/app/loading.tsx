import { getTranslations } from 'next-intl/server';

export default async function Loading() {
  const t = await getTranslations('App');
  return <p className="muted">{t('loading')}</p>;
}
