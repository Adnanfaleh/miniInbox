import type { PersonaConfig } from '../generated/prisma/client.js';
import type { LanguagePreference } from '../generated/prisma/enums.js';
import type { TenantTx } from '../with-tenant.js';

export interface PersonaWrite {
  tone: string;
  replyType: string;
  languagePreference: LanguagePreference;
  replyMaxLength: number;
  businessInstructions: string;
  outOfKbMessageEn: string;
  outOfKbMessageAr: string;
  outOfHoursMessageEn: string;
  outOfHoursMessageAr: string;
  workingDays: string;
  /** HH:MM */
  workStart: string;
  /** HH:MM */
  workEnd: string;
  handoffNoticesEnabled: boolean;
}

/** `time` columns are written as a Date on 1970-01-01 UTC. */
const timeOfDay = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);

export const persona = {
  /** The persona current at call time (D-004: no version history). */
  async get(tx: TenantTx, tenantId: string): Promise<PersonaConfig | null> {
    return tx.personaConfig.findUnique({ where: { tenantId } });
  },

  /** Creates or replaces this tenant's persona. The tenant comes from the caller's context, never the input. */
  async upsert(tx: TenantTx, tenantId: string, input: PersonaWrite): Promise<PersonaConfig> {
    const data = { ...input, workStart: timeOfDay(input.workStart), workEnd: timeOfDay(input.workEnd) };
    return tx.personaConfig.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  },
};
