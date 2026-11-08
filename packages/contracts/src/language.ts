export type ReplyLanguage = 'ar' | 'en';

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN = /[A-Za-z]/g;

/** Arabic if the text has more Arabic letters than Latin ones, otherwise English. */
export function detectLanguage(text: string): ReplyLanguage {
  const arabic = text.match(ARABIC)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  return arabic > latin ? 'ar' : 'en';
}

/** The tenant's language preference, or for `match_customer`, the script of the customer's latest message. */
export function replyLanguage(preference: 'ar' | 'en' | 'match_customer', latestCustomerText: string): ReplyLanguage {
  return preference === 'match_customer' ? detectLanguage(latestCustomerText) : preference;
}
