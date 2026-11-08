// Unit tests for the pure pipeline helpers: working hours, reply language, length trimming, chat turns.
import { describe, expect, it } from 'vitest';
import { detectLanguage, replyLanguage } from '../src/pipeline/language.js';
import { toChatTurns } from '../src/pipeline/prompts.js';
import { trimToLength } from '../src/pipeline/trim.js';
import { isWithinWorkingHours, parseWorkingDays } from '../src/pipeline/working-hours.js';

const riyadh = (iso: string) => new Date(iso); // Asia/Riyadh is UTC+3, no DST

describe('working hours', () => {
  it('parses ranges, lists and week wrap-around', () => {
    expect([...parseWorkingDays('MON-FRI')!]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseWorkingDays('THU-SUN')!].sort()).toEqual([0, 4, 5, 6]);
    expect([...parseWorkingDays('mon, wed,FRI')!]).toEqual([1, 3, 5]);
    expect(parseWorkingDays('weekdays')).toBeNull();
  });

  const hours = { timeZone: 'Asia/Riyadh', workingDays: 'SUN-THU', workStart: '09:00', workEnd: '17:00' };

  it('uses the tenant time zone', () => {
    // 2026-11-08 is a Sunday. 06:30 UTC = 09:30 in Riyadh → open; 14:30 UTC = 17:30 → closed.
    expect(isWithinWorkingHours(riyadh('2026-11-08T06:30:00Z'), hours)).toBe(true);
    expect(isWithinWorkingHours(riyadh('2026-11-08T14:30:00Z'), hours)).toBe(false);
    // Friday is not a working day.
    expect(isWithinWorkingHours(riyadh('2026-11-13T08:00:00Z'), hours)).toBe(false);
  });

  it('handles shifts that cross midnight', () => {
    const night = { timeZone: 'UTC', workingDays: 'MON', workStart: '22:00', workEnd: '02:00' };
    expect(isWithinWorkingHours(new Date('2026-11-09T23:00:00Z'), night)).toBe(true); // Monday 23:00
    expect(isWithinWorkingHours(new Date('2026-11-10T01:00:00Z'), night)).toBe(true); // Tuesday 01:00, Monday's shift
    expect(isWithinWorkingHours(new Date('2026-11-10T23:00:00Z'), night)).toBe(false); // Tuesday 23:00
  });

  it('treats an unreadable configuration as open', () => {
    expect(isWithinWorkingHours(new Date(), { ...hours, workingDays: '??' })).toBe(true);
  });
});

describe('reply language', () => {
  it('detects Arabic and English by script', () => {
    expect(detectLanguage('مرحبا، متى تفتحون؟')).toBe('ar');
    expect(detectLanguage('When do you open?')).toBe('en');
    expect(detectLanguage('hi مرحبا بكم في المتجر')).toBe('ar');
  });

  it('follows the tenant preference unless it is match_customer', () => {
    expect(replyLanguage('ar', 'hello')).toBe('ar');
    expect(replyLanguage('en', 'مرحبا')).toBe('en');
    expect(replyLanguage('match_customer', 'مرحبا')).toBe('ar');
  });
});

describe('trimToLength', () => {
  it('keeps short replies unchanged', () => {
    expect(trimToLength('  Hello.  ', 50)).toBe('Hello.');
  });

  it('cuts at the last sentence end when that keeps at least half', () => {
    expect(trimToLength('First sentence here. Second sentence is long.', 30)).toBe('First sentence here.');
    expect(trimToLength('نعم نحن مفتوحون اليوم؟ والسبب هو العطلة الطويلة', 30)).toBe('نعم نحن مفتوحون اليوم؟');
  });

  it('falls back to a word boundary and never exceeds the limit', () => {
    const out = trimToLength('one two three four five six seven', 15);
    expect(out).toBe('one two three');
    expect(trimToLength('x'.repeat(100), 10)).toHaveLength(10);
  });
});

describe('toChatTurns', () => {
  const msg = (senderType: string, body: string) => ({ senderType, body }) as never;
  it('maps senders to roles, drops SYSTEM notices, and starts with a customer turn', () => {
    expect(toChatTurns([msg('AI', 'earlier reply'), msg('CUSTOMER', 'q1'), msg('SYSTEM', 'notice'), msg('HUMAN', 'staff'), msg('CUSTOMER', 'q2')])).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'staff' },
      { role: 'user', content: 'q2' },
    ]);
  });
});
