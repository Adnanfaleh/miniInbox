import { getLocale, getTranslations } from 'next-intl/server';
import { setLocale } from '../lib/actions';
import { LOCALES } from '../lib/locale';

/** AR/EN switch: a plain form posting to a server action. */
export async function LanguageSwitcher() {
  const [t, current] = [await getTranslations('Sim.language'), await getLocale()];
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
