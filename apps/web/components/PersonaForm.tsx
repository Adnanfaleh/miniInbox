'use client';

import type { KnowledgeEntryInput, PersonaInput } from '@mini-inbox/contracts';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { savePersona, type ActionResult } from '../lib/actions';

type TextField = Exclude<keyof PersonaInput, 'knowledge' | 'replyMaxLength' | 'handoffNoticesEnabled' | 'languagePreference'>;

const EMPTY_ENTRY: KnowledgeEntryInput = { titleEn: '', titleAr: '', contentEn: '', contentAr: '' };

/**
 * The persona configuration screen. The whole form is sent as one JSON payload to a server action, validated
 * there with the shared schema, then by the API again. Field errors come back by path and are shown in place.
 */
export function PersonaForm({ initial, timeZone }: { initial: PersonaInput; timeZone: string | null }) {
  const t = useTranslations('Persona');
  const [value, setValue] = useState<PersonaInput>(initial);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(savePersona, null);
  const issues = state && !state.ok ? (state.issues ?? []) : [];
  const errorFor = (path: string) => issues.find((i) => i.path === path)?.message;
  const set = <K extends keyof PersonaInput>(key: K, v: PersonaInput[K]) => setValue((prev) => ({ ...prev, [key]: v }));
  const setEntry = (index: number, key: keyof KnowledgeEntryInput, v: string) =>
    set('knowledge', value.knowledge.map((e, i) => (i === index ? { ...e, [key]: v } : e)));

  const text = (key: TextField, opts: { multiline?: boolean; hint?: string; dir?: 'rtl' | 'ltr' | 'auto' } = {}) => {
    const err = errorFor(key);
    const common = {
      id: key,
      value: value[key] as string,
      'aria-invalid': err ? true : undefined,
      'aria-describedby': err ? `${key}-error` : opts.hint ? `${key}-hint` : undefined,
      dir: opts.dir ?? 'auto',
    };
    return (
      <div className="field">
        <label htmlFor={key}>{t(`fields.${key}`)}</label>
        {opts.multiline ? (
          <textarea {...common} rows={3} onChange={(e) => set(key, e.target.value)} />
        ) : (
          <input {...common} onChange={(e) => set(key, e.target.value)} />
        )}
        {opts.hint && !err && (
          <span id={`${key}-hint`} className="muted small">
            {opts.hint}
          </span>
        )}
        {err && (
          <span id={`${key}-error`} className="error small">
            {err}
          </span>
        )}
      </div>
    );
  };

  return (
    <form action={action} className="persona-form">
      <input type="hidden" name="payload" value={JSON.stringify(value)} />

      <fieldset>
        <legend>{t('sections.behaviour')}</legend>
        {text('tone', { multiline: true })}
        {text('replyType', { hint: t('fields.replyTypeHint') })}
        <div className="field">
          <label htmlFor="languagePreference">{t('fields.languagePreference')}</label>
          <select id="languagePreference" value={value.languagePreference} onChange={(e) => set('languagePreference', e.target.value as PersonaInput['languagePreference'])}>
            {(['match_customer', 'ar', 'en'] as const).map((l) => (
              <option key={l} value={l}>
                {t(`languages.${l}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="replyMaxLength">{t('fields.replyMaxLength')}</label>
          <input
            id="replyMaxLength"
            type="number"
            min={20}
            max={2000}
            value={value.replyMaxLength}
            aria-invalid={errorFor('replyMaxLength') ? true : undefined}
            onChange={(e) => set('replyMaxLength', Number(e.target.value))}
          />
          {errorFor('replyMaxLength') && <span className="error small">{errorFor('replyMaxLength')}</span>}
        </div>
        {text('businessInstructions', { multiline: true })}
        <div className="field checkbox">
          <input id="handoffNoticesEnabled" type="checkbox" checked={value.handoffNoticesEnabled} onChange={(e) => set('handoffNoticesEnabled', e.target.checked)} />
          <label htmlFor="handoffNoticesEnabled">{t('fields.handoffNoticesEnabled')}</label>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('sections.messages')}</legend>
        {text('outOfKbMessageEn', { multiline: true, dir: 'ltr' })}
        {text('outOfKbMessageAr', { multiline: true, dir: 'rtl' })}
        {text('outOfHoursMessageEn', { multiline: true, dir: 'ltr' })}
        {text('outOfHoursMessageAr', { multiline: true, dir: 'rtl' })}
      </fieldset>

      <fieldset>
        <legend>{t('sections.hours')}</legend>
        {text('workingDays', { hint: t('fields.workingDaysHint'), dir: 'ltr' })}
        {text('workStart', { dir: 'ltr' })}
        {text('workEnd', { dir: 'ltr' })}
        <div className="field">
          <label htmlFor="timeZone">{t('fields.timeZone')}</label>
          <input id="timeZone" value={timeZone ?? ''} readOnly dir="ltr" />
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('sections.knowledge')}</legend>
        {value.knowledge.length === 0 && <p className="muted">{t('knowledge.empty')}</p>}
        {value.knowledge.map((entry, i) => (
          <div key={i} className="knowledge-entry">
            <div className="row">
              <strong>{t('knowledge.entry', { number: i + 1 })}</strong>
              <button type="button" className="link-button" onClick={() => set('knowledge', value.knowledge.filter((_, j) => j !== i))}>
                {t('knowledge.remove')}
              </button>
            </div>
            {(['titleEn', 'titleAr', 'contentEn', 'contentAr'] as const).map((key) => {
              const path = `knowledge.${i}.${key}`;
              const err = errorFor(path);
              const isContent = key.startsWith('content');
              const dir = key.endsWith('Ar') ? 'rtl' : 'ltr';
              return (
                <div className="field" key={key}>
                  <label htmlFor={path}>{t(`knowledge.${key}`)}</label>
                  {isContent ? (
                    <textarea id={path} rows={2} dir={dir} value={entry[key]} aria-invalid={err ? true : undefined} onChange={(e) => setEntry(i, key, e.target.value)} />
                  ) : (
                    <input id={path} dir={dir} value={entry[key]} aria-invalid={err ? true : undefined} onChange={(e) => setEntry(i, key, e.target.value)} />
                  )}
                  {err && <span className="error small">{err}</span>}
                </div>
              );
            })}
          </div>
        ))}
        <button type="button" onClick={() => set('knowledge', [...value.knowledge, { ...EMPTY_ENTRY }])} disabled={value.knowledge.length >= 50}>
          {t('knowledge.add')}
        </button>
      </fieldset>

      <div className="row form-actions">
        {state?.ok && (
          <span role="status" className="success">
            {t('saved')}
          </span>
        )}
        {state && !state.ok && (
          <span role="alert" className="error">
            {t('failed')}
          </span>
        )}
        <button type="submit" className="primary" disabled={pending} aria-busy={pending}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}
