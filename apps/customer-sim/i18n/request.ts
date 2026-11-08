import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, isLocale, localeFromAcceptLanguage } from '../lib/locale';

/** next-intl without i18n routing: language cookie (AR/EN switcher), else the browser's Accept-Language. */
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : localeFromAcceptLanguage((await headers()).get('accept-language'));
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
});
