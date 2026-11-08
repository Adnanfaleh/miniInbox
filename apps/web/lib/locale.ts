export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = 'mi_locale';

export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ar';
export const directionOf = (locale: Locale): 'rtl' | 'ltr' => (locale === 'ar' ? 'rtl' : 'ltr');

/** First visit: Arabic if the browser prefers it, otherwise English. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  const first = header?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('ar') ? 'ar' : 'en';
}
