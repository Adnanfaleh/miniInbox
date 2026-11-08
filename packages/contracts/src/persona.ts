import { z } from 'zod';
import { parseWorkingDays } from './working-days.js';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24-hour)');

export const knowledgeEntryInputSchema = z.object({
  titleEn: text(1, 200),
  titleAr: text(1, 200),
  contentEn: text(1, 4000),
  contentAr: text(1, 4000),
});
export type KnowledgeEntryInput = z.infer<typeof knowledgeEntryInputSchema>;

/**
 * Body of `PUT /persona`: the whole persona plus the full list of knowledge entries (replaced together).
 * Unknown keys (tenantId, timeZone, ids) are stripped. The time zone is read-only in the MVP.
 */
export const personaInputSchema = z
  .object({
    tone: text(1, 500),
    /** Free text chosen by the tenant, e.g. "friendly" or "professional". */
    replyType: text(1, 50),
    languagePreference: z.enum(['ar', 'en', 'match_customer']),
    replyMaxLength: z.number().int().min(20).max(2000),
    businessInstructions: z.string().trim().max(4000),
    outOfKbMessageEn: text(1, 1000),
    outOfKbMessageAr: text(1, 1000),
    outOfHoursMessageEn: text(1, 1000),
    outOfHoursMessageAr: text(1, 1000),
    workingDays: text(1, 50).refine((v) => parseWorkingDays(v) !== null, 'use day names such as SUN-THU or MON,WED'),
    workStart: hhmm,
    workEnd: hhmm,
    handoffNoticesEnabled: z.boolean(),
    knowledge: z.array(knowledgeEntryInputSchema).max(50),
  })
  .refine((v) => v.workStart !== v.workEnd, { path: ['workEnd'], message: 'must differ from workStart' });
export type PersonaInput = z.infer<typeof personaInputSchema>;

export interface PersonaResponse extends Omit<PersonaInput, 'knowledge'> {
  /** Read-only in the MVP. */
  timeZone: string;
  updatedAt: string;
  knowledge: (KnowledgeEntryInput & { id: string })[];
}
