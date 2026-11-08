import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PersonaInput, PersonaResponse } from '@mini-inbox/contracts';
import { knowledge, persona, tenants, type KnowledgeEntry, type PersonaConfig } from '@mini-inbox/database';
import { PersonaCacheInvalidator } from '../cache/persona-cache-invalidator.js';
import { PrismaService } from '../database/prisma.service.js';
import { TenantDb } from '../database/tenant-db.service.js';

const hhmm = (d: Date): string => d.toISOString().slice(11, 16);

function toResponse(p: PersonaConfig, entries: KnowledgeEntry[], timeZone: string): PersonaResponse {
  return {
    tone: p.tone,
    replyType: p.replyType,
    languagePreference: p.languagePreference,
    replyMaxLength: p.replyMaxLength,
    businessInstructions: p.businessInstructions,
    outOfKbMessageEn: p.outOfKbMessageEn,
    outOfKbMessageAr: p.outOfKbMessageAr,
    outOfHoursMessageEn: p.outOfHoursMessageEn,
    outOfHoursMessageAr: p.outOfHoursMessageAr,
    workingDays: p.workingDays,
    workStart: hhmm(p.workStart),
    workEnd: hhmm(p.workEnd),
    handoffNoticesEnabled: p.handoffNoticesEnabled,
    timeZone,
    updatedAt: p.updatedAt.toISOString(),
    knowledge: entries.map((k) => ({ id: k.id, titleEn: k.titleEn, titleAr: k.titleAr, contentEn: k.contentEn, contentAr: k.contentAr })),
  };
}

/**
 * The tenant's AI persona and knowledge. Reads and writes are scoped to the tenant in the request context.
 * A save replaces the persona and the whole knowledge list in one transaction, then clears the tenant's cache.
 */
@Injectable()
export class PersonaService {
  private readonly logger = new Logger(PersonaService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly cache: PersonaCacheInvalidator,
  ) {}

  async get(): Promise<PersonaResponse> {
    const { config, entries, tenantId } = await this.db.run(async (tx, tenantId) => ({
      tenantId,
      config: await persona.get(tx, tenantId),
      entries: await knowledge.list(tx, tenantId),
    }));
    if (!config) throw new NotFoundException();
    const tenant = await tenants.findById(this.prisma.client, tenantId);
    if (!tenant) throw new NotFoundException();
    return toResponse(config, entries, tenant.timeZone);
  }

  async save(input: PersonaInput): Promise<PersonaResponse> {
    const { knowledge: entries, ...fields } = input;
    const tenantId = await this.db.run(async (tx, tenantId) => {
      await persona.upsert(tx, tenantId, fields);
      await knowledge.replaceAll(tx, tenantId, entries);
      return tenantId;
    });
    const cleared = await this.cache.invalidate(tenantId);
    this.logger.log({ knowledgeEntries: entries.length, cacheCleared: cleared }, 'persona saved');
    return this.get();
  }
}
