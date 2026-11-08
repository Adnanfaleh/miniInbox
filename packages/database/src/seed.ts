/**
 * Demo seed: two tenants with different personas, knowledge and time zones, and one person who messages both.
 *
 * Runs as the OWNER role (MIGRATION_DATABASE_URL), the admin path: it creates tenants, which the app role can't,
 * and it bypasses row-level security on purpose. Composite foreign keys still keep every row inside its tenant.
 * Idempotent: fixed tenant IDs and fixed external IDs, all written with upserts.
 *
 * Only customer messages are seeded (applicant decision). In each conversation the last customer message is
 * PENDING and is queued on `inbound-message` after the commit, so the real worker answers it. Earlier messages are
 * history (reply_status NULL) that the worker reads as context. Nothing AI-written is seeded.
 * A message the worker has already settled (replied, skipped, failed) is never queued again, so re-running the
 * seed never causes a second reply. Re-running the seed resets the two demo personas and their knowledge lists.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  INBOUND_MESSAGE_JOB,
  INBOUND_MESSAGE_JOB_OPTIONS,
  INBOUND_MESSAGE_QUEUE,
  inboundMessageJobId,
  type InboundMessageJob,
} from '@mini-inbox/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';

export const SEED_TENANTS = {
  coffee: '11111111-1111-4111-8111-111111111111',
  clinic: '22222222-2222-4222-8222-222222222222',
} as const;

/** The same real person contacts both businesses. Each tenant gets its own customer record and random ID. */
export const SHARED_PERSON = '+966500000001';

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

interface TenantSeed {
  id: string;
  name: string;
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
  };
  knowledge: { titleEn: string; titleAr: string; contentEn: string; contentAr: string }[];
  /** Customer messages per sender, oldest first. */
  conversations: { from: string; displayName: string | null; messages: { externalId: string; text: string }[] }[];
}

const TENANTS: TenantSeed[] = [
  {
    id: SEED_TENANTS.coffee,
    name: 'Riyadh Coffee House',
    timeZone: 'Asia/Riyadh',
    persona: {
      tone: 'Warm, friendly and brief. Greet the customer and keep answers short.',
      languagePreference: 'match_customer',
      replyType: 'friendly',
      replyMaxLength: 300,
      businessInstructions: 'We are a coffee shop. We do not deliver. Never promise reservations or discounts.',
      outOfKbMessageEn: 'Good question! Let me check with the team and get back to you.',
      outOfKbMessageAr: 'سؤال جميل! سأتحقق مع الفريق وأعود إليك.',
      outOfHoursMessageEn: 'We are closed right now. We open Sunday to Thursday, 8am to 11pm.',
      outOfHoursMessageAr: 'نحن مغلقون الآن. نفتح من الأحد إلى الخميس، من 8 صباحًا حتى 11 مساءً.',
      workingDays: 'SUN-THU',
      workStart: '08:00',
      workEnd: '23:00',
    },
    knowledge: [
      {
        titleEn: 'Opening hours',
        titleAr: 'ساعات العمل',
        contentEn: 'Open Sunday to Thursday from 8am to 11pm. Closed Friday and Saturday.',
        contentAr: 'نفتح من الأحد إلى الخميس من 8 صباحًا حتى 11 مساءً. مغلق يومي الجمعة والسبت.',
      },
      {
        titleEn: 'Menu prices',
        titleAr: 'أسعار القائمة',
        contentEn: 'Espresso 10 SAR, latte 15 SAR, cappuccino 15 SAR, croissant 9 SAR.',
        contentAr: 'إسبريسو 10 ريال، لاتيه 15 ريال، كابتشينو 15 ريال، كرواسون 9 ريال.',
      },
      {
        titleEn: 'Wi-Fi',
        titleAr: 'الواي فاي',
        contentEn: 'Free Wi-Fi for customers. Ask the barista for the password.',
        contentAr: 'واي فاي مجاني للعملاء. اطلب كلمة المرور من الباريستا.',
      },
      {
        titleEn: 'Delivery',
        titleAr: 'التوصيل',
        contentEn: 'We do not offer delivery. Pick-up only.',
        contentAr: 'لا نقدم خدمة التوصيل. الاستلام من المحل فقط.',
      },
    ],
    conversations: [
      {
        from: SHARED_PERSON,
        displayName: null,
        messages: [
          { externalId: 'seed-coffee-1', text: 'مرحبا، كم سعر اللاتيه؟' },
          { externalId: 'seed-coffee-2', text: 'وهل عندكم واي فاي؟' },
        ],
      },
      {
        from: '+966500000002',
        displayName: 'Noura',
        messages: [{ externalId: 'seed-coffee-3', text: 'Hi! Do you deliver to Olaya?' }],
      },
    ],
  },
  {
    id: SEED_TENANTS.clinic,
    name: 'London Dental Clinic',
    timeZone: 'Europe/London',
    persona: {
      tone: 'Professional, calm and precise. Never give medical diagnoses.',
      languagePreference: 'en',
      replyType: 'professional',
      replyMaxLength: 500,
      businessInstructions: 'Dental clinic. For pain or swelling, advise calling the clinic. Do not confirm appointments in chat.',
      outOfKbMessageEn: 'Thank you for your message. A member of our team will reply during opening hours.',
      outOfKbMessageAr: 'شكرًا لرسالتك. سيرد عليك أحد أعضاء فريقنا خلال ساعات العمل.',
      outOfHoursMessageEn: 'The clinic is closed. We are open Monday to Friday, 9:00 to 17:30 (UK time).',
      outOfHoursMessageAr: 'العيادة مغلقة. نعمل من الاثنين إلى الجمعة، من 9:00 حتى 17:30 بتوقيت المملكة المتحدة.',
      workingDays: 'MON-FRI',
      workStart: '09:00',
      workEnd: '17:30',
    },
    knowledge: [
      {
        titleEn: 'Opening hours',
        titleAr: 'ساعات العمل',
        contentEn: 'Monday to Friday, 9:00 to 17:30 UK time. Closed on weekends and bank holidays.',
        contentAr: 'من الاثنين إلى الجمعة، من 9:00 حتى 17:30 بتوقيت المملكة المتحدة. مغلق في عطلات نهاية الأسبوع والعطل الرسمية.',
      },
      {
        titleEn: 'Checkup price',
        titleAr: 'سعر الفحص',
        contentEn: 'A routine checkup costs £60 and includes a scale and polish.',
        contentAr: 'يكلف الفحص الدوري 60 جنيهًا إسترلينيًا ويشمل التنظيف والتلميع.',
      },
      {
        titleEn: 'Booking',
        titleAr: 'الحجز',
        contentEn: 'Appointments are booked by phone on 020 7946 0000 or at reception.',
        contentAr: 'تُحجز المواعيد عبر الهاتف على الرقم 020 7946 0000 أو من الاستقبال.',
      },
      {
        titleEn: 'Emergencies',
        titleAr: 'الحالات الطارئة',
        contentEn: 'For severe pain or swelling, call us as soon as we open. Out of hours, call NHS 111.',
        contentAr: 'في حالة الألم الشديد أو التورم، اتصل بنا فور فتح العيادة. خارج ساعات العمل، اتصل بالرقم 111.',
      },
    ],
    conversations: [
      {
        from: SHARED_PERSON,
        displayName: null,
        messages: [{ externalId: 'seed-clinic-1', text: 'Hello, how much is a routine checkup?' }],
      },
      {
        from: 'james.walker@example.com',
        displayName: 'James',
        messages: [{ externalId: 'seed-clinic-2', text: 'Can I book an appointment for next Tuesday?' }],
      },
    ],
  },
];

export interface SeedResult {
  tenants: number;
  /** Seeded messages still waiting for the worker. IDs only, ready to queue. */
  pending: InboundMessageJob[];
}

/** Writes the demo data. Safe to run repeatedly. Queueing the pending messages is the caller's job (see `main`). */
export async function seed(owner: PrismaClient, now: Date = new Date()): Promise<SeedResult> {
  const pending: InboundMessageJob[] = [];
  for (const t of TENANTS) {
    await owner.$transaction(async (tx) => {
      await tx.tenant.upsert({ where: { id: t.id }, create: { id: t.id, name: t.name, timeZone: t.timeZone }, update: { name: t.name, timeZone: t.timeZone } });
      const persona = { ...t.persona, workStart: time(t.persona.workStart), workEnd: time(t.persona.workEnd), handoffNoticesEnabled: true };
      await tx.personaConfig.upsert({ where: { tenantId: t.id }, create: { tenantId: t.id, ...persona }, update: persona });
      await tx.knowledgeEntry.deleteMany({ where: { tenantId: t.id } });
      await tx.knowledgeEntry.createMany({ data: t.knowledge.map((k) => ({ tenantId: t.id, ...k })) });

      let minute = 60;
      for (const c of t.conversations) {
        const customer = await tx.customer.upsert({
          where: { tenantId_externalRef: { tenantId: t.id, externalRef: c.from } },
          create: { tenantId: t.id, externalRef: c.from, displayName: c.displayName },
          update: { displayName: c.displayName },
        });
        const conversation = await tx.conversation.upsert({
          where: { tenantId_customerId: { tenantId: t.id, customerId: customer.id } },
          create: { tenantId: t.id, customerId: customer.id, createdAt: new Date(now.getTime() - minute * 60_000) },
          update: {},
        });
        for (const [index, m] of c.messages.entries()) {
          const isLast = index === c.messages.length - 1;
          let row = await tx.message.upsert({
            where: { tenantId_externalId: { tenantId: t.id, externalId: m.externalId } },
            create: {
              tenantId: t.id,
              conversationId: conversation.id,
              senderType: 'CUSTOMER',
              externalId: m.externalId,
              body: m.text,
              replyStatus: isLast ? 'PENDING' : null,
              createdAt: new Date(now.getTime() - minute * 60_000),
            },
            update: {},
          });
          // A database seeded before queueing existed has the last message as never-queued history (NULL).
          // Only NULL is upgraded: a settled message (REPLIED, SKIPPED, FAILED) is left alone.
          if (isLast && row.replyStatus === null) {
            row = await tx.message.update({ where: { tenantId_id: { tenantId: t.id, id: row.id } }, data: { replyStatus: 'PENDING' } });
          }
          if (isLast && row.replyStatus === 'PENDING') {
            pending.push({ tenantId: t.id, conversationId: row.conversationId, messageId: row.id });
          }
          minute -= 5;
        }
        minute -= 10;
      }
    });
  }
  return { tenants: TENANTS.length, pending };
}

/**
 * Adds the pending seeded messages to the `inbound-message` queue with the webhook's job ID and options.
 * Re-adding a job ID that is still queued is a no-op. Fails fast if Redis is unreachable; the rows stay
 * PENDING, so running the seed again queues them.
 */
async function enqueue(jobs: InboundMessageJob[], redisUrl: string, prefix: string): Promise<void> {
  const connection = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1, retryStrategy: () => null });
  connection.on('error', () => undefined); // reported by connect() below
  try {
    await connection.connect();
    const queue = new Queue<InboundMessageJob>(INBOUND_MESSAGE_QUEUE, { connection, prefix });
    try {
      for (const job of jobs) {
        await queue.add(INBOUND_MESSAGE_JOB, job, { ...INBOUND_MESSAGE_JOB_OPTIONS, jobId: inboundMessageJobId(job.tenantId, job.messageId) });
      }
    } finally {
      await queue.close();
    }
  } finally {
    connection.disconnect();
  }
}

async function main(): Promise<void> {
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set (see .env.example)');
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set (see .env.example)');
  const owner = createPrismaClient(url);
  let result: SeedResult;
  try {
    result = await seed(owner);
  } finally {
    await owner.$disconnect();
  }
  console.log(`Seeded ${result.tenants} demo tenants: Riyadh Coffee House (${SEED_TENANTS.coffee}), London Dental Clinic (${SEED_TENANTS.clinic}).`);
  try {
    await enqueue(result.pending, redisUrl, process.env.QUEUE_PREFIX || 'mini-inbox');
  } catch (err) {
    console.error(`Queueing seeded messages failed (${(err as NodeJS.ErrnoException).code ?? (err as Error).name}). Is Redis running? Run the seed again to retry.`);
    throw err;
  }
  console.log(`Queued ${result.pending.length} seeded customer messages for the worker.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: Error) => {
    console.error(`Seed failed: ${err.name}`);
    process.exitCode = 1;
  });
}
