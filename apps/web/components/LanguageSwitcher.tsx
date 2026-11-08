import { getLocale, getTranslations } from 'next-intl/server';
import { setLocale } from '../lib/actions';
import { LOCALES } from '../lib/locale';

/** AR/EN switch. A plain form posting to a server action: works without client JavaScript. */
export async function LanguageSwitcher() {
  const [t, current] = [await getTranslations('App.language'), await getLocale()];
  return (
    <form action={setLocale} className="lang-switch" aria-label={t('label')}>
      {LOCALES.map((locale) => (
        <button key={locale} type="submit" name="locale" value={locale} aria-pressed={locale === current} lang={locale}>
          {t(locale)}
        </button>
      ))}
    </form>
  );
}
