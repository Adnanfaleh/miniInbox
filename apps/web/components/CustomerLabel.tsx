import { detectLanguage } from '@mini-inbox/contracts';

/**
 * A customer label (name or sender address) keeps its own direction: phone numbers and Latin names stay
 * left-to-right inside the Arabic layout, Arabic names right-to-left.
 */
export function CustomerLabel({ label, className }: { label: string; className?: string }) {
  return (
    <bdi dir={detectLanguage(label) === 'ar' ? 'rtl' : 'ltr'} className={className}>
      {label}
    </bdi>
  );
}
