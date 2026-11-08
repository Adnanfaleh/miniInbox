import type { KnowledgeEntry, PersonaConfig, Tenant } from '@mini-inbox/database';

/**
 * Everything the AI needs from one tenant: its time zone, persona and knowledge entries. Built only from that
 * tenant's rows, cached under that tenant's key, and checked against the tenant on read.
 */
export interface TenantSnapshot {
  tenantId: string;
  timeZone: string;
  persona: {
    tone: string;
    languagePreference: 'ar' | 'en' | 'match_customer';
    replyType: string;
    replyMaxLength: number;
    businessInstructions: string;
    outOfKbMessageEn: string;
    outOfKbMessageAr: string;
    outOfHoursMessageEn: string;
    outOfHoursMessageAr: string;
    workingDays: string;
    workStart: string;
    workEnd: string;
  } | null;
  knowledge: { titleEn: string; titleAr: string; contentEn: string; contentAr: string }[];
}

/** Prisma returns `time` columns as a Date on 1970-01-01 UTC. */
const hhmm = (d: Date): string => d.toISOString().slice(11, 16);

export function buildSnapshot(tenant: Tenant, persona: PersonaConfig | null, knowledge: KnowledgeEntry[]): TenantSnapshot {
  return {
    tenantId: tenant.id,
    timeZone: tenant.timeZone,
    persona: persona && {
      tone: persona.tone,
      languagePreference: persona.languagePreference,
      replyType: persona.replyType,
      replyMaxLength: persona.replyMaxLength,
      businessInstructions: persona.businessInstructions,
      outOfKbMessageEn: persona.outOfKbMessageEn,
      outOfKbMessageAr: persona.outOfKbMessageAr,
      outOfHoursMessageEn: persona.outOfHoursMessageEn,
      outOfHoursMessageAr: persona.outOfHoursMessageAr,
      workingDays: persona.workingDays,
      workStart: hhmm(persona.workStart),
      workEnd: hhmm(persona.workEnd),
    },
    knowledge: knowledge.map((k) => ({ titleEn: k.titleEn, titleAr: k.titleAr, contentEn: k.contentEn, contentAr: k.contentAr })),
  };
}
