import type { ReplyLanguage } from '@mini-inbox/contracts';

/**
 * Fixed texts of the automatic handoff notices (stored as SYSTEM messages). Tenants can turn the notices off;
 * editable texts would be a later persona feature.
 */
export const HANDOFF_NOTICES: Record<'takeover' | 'return', Record<ReplyLanguage, string>> = {
  takeover: {
    en: 'A member of our team has joined the conversation and will reply to you.',
    ar: 'انضم أحد أعضاء فريقنا إلى المحادثة وسيرد عليك.',
  },
  return: {
    en: 'You are now chatting with our AI assistant again.',
    ar: 'أنت الآن تتحدث مع مساعدنا الذكي مرة أخرى.',
  },
};
