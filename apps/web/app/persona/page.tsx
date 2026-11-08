import { getTranslations } from 'next-intl/server';
import type { PersonaInput } from '@mini-inbox/contracts';
import { PersonaForm } from '../../components/PersonaForm';
import { ApiError, api } from '../../lib/api';
import { requireTenant } from '../../lib/session';

const BLANK: PersonaInput = {
  tone: '',
  replyType: '',
  languagePreference: 'match_customer',
  replyMaxLength: 400,
  businessInstructions: '',
  outOfKbMessageEn: '',
  outOfKbMessageAr: '',
  outOfHoursMessageEn: '',
  outOfHoursMessageAr: '',
  workingDays: 'SUN-THU',
  workStart: '09:00',
  workEnd: '17:00',
  handoffNoticesEnabled: true,
  knowledge: [],
};

export default async function PersonaPage() {
  await requireTenant();
  const t = await getTranslations('Persona');
  let initial = BLANK;
  let timeZone: string | null = null;
  let missing = false;
  try {
    const { timeZone: tz, updatedAt: _updatedAt, knowledge, ...fields } = await api.persona();
    initial = { ...fields, knowledge: knowledge.map(({ id: _id, ...entry }) => entry) };
    timeZone = tz;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) missing = true;
    else throw err;
  }
  return (
    <section className="pane narrow">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      {missing && <p className="muted">{t('noPersona')}</p>}
      <PersonaForm initial={initial} timeZone={timeZone} />
    </section>
  );
}
