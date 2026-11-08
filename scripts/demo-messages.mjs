// DEMO / LOCAL ONLY. Sends customer messages to the two seeded demo tenants through the webhook and checks the
// worker's replies through the tenant-scoped read API, the way a channel and the dashboard would.
//
//   pnpm dev                # API, worker and dashboard running
//   pnpm demo:messages      # this script
//
// Uses whatever AI provider the worker runs: the real model when ANTHROPIC_API_KEY is set (about 40 short calls),
// otherwise the labelled mock. Every run uses fresh message IDs and customer addresses, so runs never dedupe each
// other. The clinic is opened temporarily (persona working hours) to get real replies, and always restored.
// Tenant reads send `x-tenant-id`: the documented development stand-in, not authentication.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWorkingDays } from '../packages/contracts/dist/index.js';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(API).hostname)) {
  console.error(`Refusing to run: API_BASE_URL (${API}) is not local. This demo script is for local development only.`);
  process.exit(1);
}

const COFFEE = '11111111-1111-4111-8111-111111111111';
const CLINIC = '22222222-2222-4222-8222-222222222222';
const NAMES = { [COFFEE]: 'Riyadh Coffee House', [CLINIC]: 'London Dental Clinic' };
const RUN = Date.now().toString(36);
const RUN_DIGITS = String(Date.now()).slice(-6);
const phone = (n) => `+9665${RUN_DIGITS}${String(n).padStart(2, '0')}`;
const ARABIC = /[؀-ۿ]/;
let seq = 0;

// ---------- HTTP ----------
async function http(method, path, { tenant, body } = {}) {
  const headers = {};
  if (tenant) headers['x-tenant-id'] = tenant;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const send = (tenant, from, text, externalId = `demo-${RUN}-${++seq}`) =>
  http('POST', `/webhook/${tenant}/message`, { body: { externalId, from, text } }).then((r) => ({ ...r, externalId }));
const conversation = async (tenant, id) => (await http('GET', `/conversations/${id}?limit=100`, { tenant })).json;
const persona = async (tenant) => (await http('GET', '/persona', { tenant })).json;

/** Polls until no customer message in these conversations is PENDING. */
async function waitSettled(tenant, ids, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const details = await Promise.all(ids.map((id) => conversation(tenant, id)));
    const pending = details.flatMap((d) => d.messages).filter((m) => m.senderType === 'CUSTOMER' && m.replyStatus === 'PENDING');
    if (pending.length === 0) return details;
    if (Date.now() > until) throw new Error(`timed out waiting for ${pending.length} pending message(s) in ${NAMES[tenant]}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ---------- checks ----------
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  return ok;
};
const skip = (name, reason) => results.push({ name, status: 'SKIP', detail: reason });
const tracked = []; // [tenant, conversationId] printed at the end

const replyTo = (detail, messageId) => detail.messages.find((m) => m.senderType === 'AI' && m.inReplyToMessageId === messageId);
const message = (detail, messageId) => detail.messages.find((m) => m.id === messageId);

/** Working-hours check, same rules as the worker: days in the tenant's time zone, end before start wraps midnight. */
function isOpen(p) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: p.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].indexOf(get('weekday').toUpperCase().slice(0, 3));
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  const m = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const [start, end] = [m(p.workStart), m(p.workEnd)];
  const inTime = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  return Boolean(parseWorkingDays(p.workingDays)?.has(day)) && inTime;
}

const lang = (p, text) => (p.languagePreference === 'match_customer' ? (ARABIC.test(text) ? 'Ar' : 'En') : p.languagePreference === 'ar' ? 'Ar' : 'En');

/**
 * The customer message got its reply: during working hours an AI answer (real model or out-of-KB message);
 * outside them, the tenant's out-of-hours message.
 */
function checkAnswered(label, p, open, detail, messageId, text) {
  const msg = message(detail, messageId);
  const reply = replyTo(detail, messageId);
  if (!check(`${label}: replied`, msg?.replyStatus === 'REPLIED' && Boolean(reply), `status ${msg?.replyStatus}`)) return null;
  const outOfHours = p[`outOfHoursMessage${lang(p, text)}`];
  if (!open) check(`${label}: out-of-hours message (closed now)`, reply.body === outOfHours);
  else check(`${label}: answered, not the out-of-hours message`, reply.body !== outOfHours);
  return reply;
}

function toInput(p) {
  const keys = ['tone', 'replyType', 'languagePreference', 'replyMaxLength', 'businessInstructions', 'outOfKbMessageEn', 'outOfKbMessageAr',
    'outOfHoursMessageEn', 'outOfHoursMessageAr', 'workingDays', 'workStart', 'workEnd', 'handoffNoticesEnabled'];
  const input = Object.fromEntries(keys.map((k) => [k, p[k]]));
  input.knowledge = p.knowledge.map(({ titleEn, titleAr, contentEn, contentAr }) => ({ titleEn, titleAr, contentEn, contentAr }));
  return input;
}

// ---------- scenarios ----------
async function main() {
  console.log(`Mini Inbox demo run ${RUN} against ${API}\n`);
  const coffeeP = await persona(COFFEE);
  const clinicP = await persona(CLINIC);
  if (!coffeeP || !clinicP) throw new Error('Seeded tenants not found. Run `pnpm db:seed` and make sure the API is running.');
  const coffeeOpen = isOpen(coffeeP);
  if (!coffeeOpen) console.log(`Note: ${NAMES[COFFEE]} is closed right now, so its customers get the out-of-hours message.\n`);
  const shared = phone(1);

  // 1. One customer, one message.
  const t1 = 'Hi, how much is a latte?';
  const r1 = await send(COFFEE, shared, t1);
  check('#1 webhook accepted (202)', r1.status === 202, `HTTP ${r1.status}`);
  const coffeeShared = r1.json.conversationId;
  tracked.push([COFFEE, coffeeShared]);
  let [d] = await waitSettled(COFFEE, [coffeeShared]);
  const a1 = checkAnswered('#1', coffeeP, coffeeOpen, d, r1.json.messageId, t1);
  if (coffeeOpen && a1) {
    check('#1 reply mentions the latte price (15)', a1.body.includes('15'));
    const m1 = message(d, r1.json.messageId);
    check('#1 classified simple / question', m1.complexity === 'simple' && m1.intent === 'question', `${m1.complexity} / ${m1.intent}`);
  }

  // 2. Same customer, three messages in a row.
  const texts2 = [
    'Hello!',
    'Do you have Wi-Fi?',
    'We are planning a team event for 40 people next month. Could you prepare a mix of drinks and pastries, and what would it cost?',
  ];
  const r2 = [];
  for (const t of texts2) r2.push(await send(COFFEE, shared, t));
  check('#2 same customer stays in one conversation', r2.every((r) => r.status === 202 && r.json.conversationId === coffeeShared));
  [d] = await waitSettled(COFFEE, [coffeeShared]);
  r2.forEach((r, i) => checkAnswered(`#2.${i + 1}`, coffeeP, coffeeOpen, d, r.json.messageId, texts2[i]));
  const customerOrder = d.messages.filter((m) => m.senderType === 'CUSTOMER').map((m) => m.id);
  const replyOrder = d.messages.filter((m) => m.senderType === 'AI').map((m) => customerOrder.indexOf(m.inReplyToMessageId));
  check('#2 replies written in arrival order', replyOrder.every((v, i) => i === 0 || v > replyOrder[i - 1]), `reply order ${replyOrder.join(',')}`);

  // 3. Five different customers at the same time.
  const burst = [
    { from: phone(2), text: 'What time do you close today?' },
    { from: phone(3), text: 'كم سعر الكابتشينو؟' },
    { from: phone(4), text: 'Do you deliver to Olaya?' },
    { from: phone(5), text: 'هل يوجد واي فاي مجاني؟' },
    { from: phone(6), text: 'I want 3 lattes and 2 croissants. How much is that in total?' },
  ];
  const r3 = await Promise.all(burst.map((b) => send(COFFEE, b.from, b.text)));
  const convs3 = r3.map((r) => r.json.conversationId);
  check('#3 five customers → five new conversations', r3.every((r) => r.status === 202) && new Set([...convs3, coffeeShared]).size === 6);
  tracked.push(...convs3.map((c) => [COFFEE, c]));
  const d3 = await waitSettled(COFFEE, convs3);
  d3.forEach((det, i) => {
    const reply = checkAnswered(`#3.${i + 1}`, coffeeP, coffeeOpen, det, r3[i].json.messageId, burst[i].text);
    if (reply && coffeeOpen) {
      const arabic = ARABIC.test(burst[i].text);
      check(`#3.${i + 1} reply language matches the customer (${arabic ? 'Arabic' : 'English'})`, ARABIC.test(reply.body) === arabic);
    }
  });

  // 4. Outside the knowledge base.
  const t4 = 'Do you sell gift cards?';
  const r4 = await send(COFFEE, phone(7), t4);
  tracked.push([COFFEE, r4.json.conversationId]);
  [d] = await waitSettled(COFFEE, [r4.json.conversationId]);
  const a4 = checkAnswered('#4', coffeeP, coffeeOpen, d, r4.json.messageId, t4);
  if (coffeeOpen && a4) check('#4 out-of-knowledge-base message', a4.body === coffeeP.outOfKbMessageEn);

  // 5. Duplicate delivery of #1.
  const before = (await conversation(COFFEE, coffeeShared)).messages.length;
  const r5 = await send(COFFEE, shared, t1, r1.externalId);
  await new Promise((r) => setTimeout(r, 3000));
  const after = (await conversation(COFFEE, coffeeShared)).messages.length;
  check('#5 duplicate delivery: 202, same message, nothing new', r5.status === 202 && r5.json.messageId === r1.json.messageId && after === before, `${before} → ${after} messages`);

  // 6. Same person, clinic, while the clinic is closed.
  const clinicOpen = isOpen(clinicP);
  const t6 = 'Hello, how much is a routine checkup?';
  const r6 = await send(CLINIC, shared, t6);
  const clinicShared = r6.json.conversationId;
  tracked.push([CLINIC, clinicShared]);
  [d] = await waitSettled(CLINIC, [clinicShared]);
  const coffeeDetail = await conversation(COFFEE, coffeeShared);
  check('#6 same person, separate conversation and customer ID per tenant', clinicShared !== coffeeShared && d.conversation.customer.id !== coffeeDetail.conversation.customer.id);
  if (clinicOpen) skip('#6 out-of-hours reply', 'the clinic is open right now');
  else {
    const a6 = replyTo(d, r6.json.messageId);
    check('#6 clinic closed: out-of-hours message, no classification', a6?.body === clinicP.outOfHoursMessageEn && message(d, r6.json.messageId).complexity === null);
  }

  // 7. Clinic opened temporarily: real replies.
  const original = toInput(clinicP);
  const opened = await http('PUT', '/persona', { tenant: CLINIC, body: { ...original, workingDays: 'SUN-SAT', workStart: '00:00', workEnd: '23:59' } });
  check('#7 clinic opened for the test (PUT /persona)', opened.status === 200, `HTTP ${opened.status}`);
  try {
    const sends7 = [
      { from: shared, text: 'Do you treat emergencies?' },
      { from: phone(8), text: 'How much is a routine checkup?' },
      { from: phone(10), text: 'Can I book an appointment for next Tuesday?' },
    ];
    const r7 = await Promise.all(sends7.map((s) => send(CLINIC, s.from, s.text)));
    const convs7 = [...new Set(r7.map((r) => r.json.conversationId))];
    tracked.push(...convs7.filter((c) => c !== clinicShared).map((c) => [CLINIC, c]));
    const d7 = await waitSettled(CLINIC, convs7);
    r7.forEach((r, i) => {
      const det = d7.find((x) => x.conversation.id === r.json.conversationId);
      const reply = checkAnswered(`#7.${i + 1}`, clinicP, true,det, r.json.messageId, sends7[i].text);
      if (reply) check(`#7.${i + 1} reply in English (clinic language)`, !ARABIC.test(reply.body));
    });
  } finally {
    const restored = await http('PUT', '/persona', { tenant: CLINIC, body: original });
    const now = await persona(CLINIC);
    const ok = restored.status === 200 && now.workingDays === clinicP.workingDays && now.workStart === clinicP.workStart && now.workEnd === clinicP.workEnd;
    if (!check('#7 clinic hours restored', ok)) console.error('WARNING: the clinic persona was not restored. Run `pnpm db:seed` to reset the demo personas.');
  }

  // 8. Isolation through the API.
  const crossA = await http('GET', `/conversations/${coffeeShared}`, { tenant: CLINIC });
  const crossB = await http('GET', `/conversations/${clinicShared}`, { tenant: COFFEE });
  check('#8 cross-tenant reads return 404 both ways', crossA.status === 404 && crossB.status === 404, `${crossA.status} / ${crossB.status}`);
  const coffeeList = (await http('GET', '/conversations?limit=50', { tenant: COFFEE })).json.items.map((c) => c.id);
  const clinicList = (await http('GET', '/conversations?limit=50', { tenant: CLINIC })).json.items.map((c) => c.id);
  const clinicRun = tracked.filter(([t]) => t === CLINIC).map(([, c]) => c);
  const coffeeRun = tracked.filter(([t]) => t === COFFEE).map(([, c]) => c);
  check('#8 each tenant lists only its own run conversations', !clinicRun.some((c) => coffeeList.includes(c)) && !coffeeRun.some((c) => clinicList.includes(c)));

  // 9. Takeover: the AI stays silent.
  const takeConv = convs3[0];
  const tk = await http('POST', `/conversations/${takeConv}/takeover`, { tenant: COFFEE });
  check('#9 takeover', tk.status === 200 && tk.json.mode === 'HUMAN', `HTTP ${tk.status}`);
  const r9 = await send(COFFEE, burst[0].from, 'Can I talk to a person, please?');
  [d] = await waitSettled(COFFEE, [takeConv]);
  check('#9 message during takeover is SKIPPED, no AI reply', message(d, r9.json.messageId)?.replyStatus === 'SKIPPED' && !replyTo(d, r9.json.messageId));
  if (coffeeP.handoffNoticesEnabled) check('#9 handoff notice stored as SYSTEM', d.messages.some((m) => m.senderType === 'SYSTEM'));

  // 10. Return to AI: answered again.
  const back = await http('POST', `/conversations/${takeConv}/return-to-ai`, { tenant: COFFEE });
  check('#10 return to AI', back.status === 200 && back.json.mode === 'AI', `HTTP ${back.status}`);
  const t10 = 'Thanks. One more question: how much is an espresso?';
  const r10 = await send(COFFEE, burst[0].from, t10);
  [d] = await waitSettled(COFFEE, [takeConv]);
  checkAnswered('#10', coffeeP, coffeeOpen, d, r10.json.messageId, t10);

  // 11. Invalid input.
  const unknown = await send('33333333-3333-4333-8333-333333333333', phone(9), 'Hello');
  const blank = await send(COFFEE, phone(9), '   ');
  check('#11 unknown tenant → 404, blank text → 400', unknown.status === 404 && blank.status === 400, `${unknown.status} / ${blank.status}`);
  const spaced = await send(COFFEE, '+966 50 000 0009', 'Hello');
  const email = await send(COFFEE, 'someone@example.com', 'Hello');
  check('#11 sender must be + and digits only: spaces → 400, email → 400', spaced.status === 400 && email.status === 400, `${spaced.status} / ${email.status}`);
  const reused = await send(COFFEE, phone(9), 'Hello', r1.externalId);
  check('#11 message ID reused by a different sender → 409', reused.status === 409, `HTTP ${reused.status}`);
}

async function printThreads() {
  console.log('\nThreads (newest run only):');
  for (const [tenant, id] of tracked) {
    const det = await conversation(tenant, id);
    if (!det) continue;
    console.log(`\n${NAMES[tenant]} · ${det.conversation.customer.label} · mode ${det.conversation.mode}`);
    for (const m of det.messages) {
      const meta = m.senderType === 'CUSTOMER' ? ` ${m.replyStatus ?? 'history'}${m.complexity ? ` ${m.complexity}/${m.intent}` : ''}` : '';
      const body = m.body.replace(/\s+/g, ' ');
      console.log(`  [${m.senderType}${meta}] ${body.length > 80 ? `${body.slice(0, 80)}…` : body}`);
    }
  }
}

let crashed = null;
try {
  await main();
} catch (err) {
  crashed = err;
}
await printThreads().catch(() => undefined);
console.log('\nResults:');
for (const r of results) console.log(`  ${r.status.padEnd(4)}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n${results.filter((r) => r.status === 'PASS').length} passed, ${failed} failed, ${results.filter((r) => r.status === 'SKIP').length} skipped`);
if (crashed) console.error(`Stopped early: ${crashed.message}`);
process.exitCode = failed || crashed ? 1 : 0;
