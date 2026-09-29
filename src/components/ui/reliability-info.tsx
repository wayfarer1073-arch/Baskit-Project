'use client';

import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import type { Reliability, ReliabilityNote } from '@/domain/reliability/reliability';

/** 신뢰도 점수와 그렇게 판단한 이유를 툴팁으로 보여준다. */
export function ReliabilityInfo({ reliability, className }: { reliability: Reliability | null | undefined; className?: string }) {
  const { m } = useI18n();
  if (!reliability) return null;
  const t = m.reliability;
  const describe = (note: ReliabilityNote) => {
    const { code, ...vars } = note;
    return format(t.notes[code], Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)])));
  };
  return (
    <InfoTooltip className={className}>
      <span className="block font-medium">
        {format(t.score, { score: String(reliability.score) })} · {t.levels[reliability.level]}
      </span>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {reliability.notes.map((note, i) => (
          <li key={i}>{describe(note)}</li>
        ))}
      </ul>
      <span className="mt-1 block opacity-70">{t.formula}</span>
    </InfoTooltip>
  );
}
