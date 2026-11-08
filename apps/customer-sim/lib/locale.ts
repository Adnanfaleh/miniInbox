export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
/** Own cookie name: the simulator's language is independent of the dashboard's (cookies are shared across localhost ports). */
export const LOCALE_COOKIE = 'mi_sim_locale';

export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ar';
export const directionOf = (locale: Locale): 'rtl' | 'ltr' => (locale === 'ar' ? 'rtl' : 'ltr');

/** First visit: Arabic if the browser prefers it, otherwise English. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  const first = header?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('ar') ? 'ar' : 'en';
}
