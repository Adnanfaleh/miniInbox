import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, isLocale, localeFromAcceptLanguage } from '../lib/locale';

/**
 * next-intl without i18n routing: the locale comes from the language cookie (set by the AR/EN switcher),
 * falling back to the browser's Accept-Language on the first visit. URLs carry no locale.
 */
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : localeFromAcceptLanguage((await headers()).get('accept-language'));
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
});
