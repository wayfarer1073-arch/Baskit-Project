'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gaegu } from 'next/font/google';
import { ArrowLeft, Check, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { EasyCountItem } from '@/domain/segments/read-model';
import { DashboardEmptyState } from '@/components/dashboard/dashboard-masthead';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/** 지난 기록은 연필로 적어 둔 것처럼 손글씨로 보여 준다(숫자 입력은 또렷한 본문 서체). */
const hand = Gaegu({ weight: ['400', '700'], subsets: ['latin'], preload: false, display: 'swap' });

const QUICK_PERCENTS = [25, 50, 75] as const;
/** 수첩 종이 — 앱의 흰 패널과 구분되는 따뜻한 미색, 하늘색 괘선, 붉은 여백선. */
const PAPER = 'bg-[oklch(0.985_0.014_92)]';
const PAPER_EDGE = 'bg-[oklch(0.965_0.016_90)]';
const RULE = 'border-[oklch(0.87_0.035_235)]';
const MARGIN_LINE = 'bg-[oklch(0.72_0.13_22/0.55)]';

interface Draft {
  ea: string;
  pct: string;
}

const draftOf = (item: EasyCountItem): Draft => ({
  ea: item.current ? String(item.current.fullUnits) : '',
  pct: item.current?.openedPercent != null ? String(item.current.openedPercent) : '',
});
const sameDraft = (a: Draft, b: Draft) => a.ea.trim() === b.ea.trim() && a.pct.trim() === b.pct.trim();
const isFilled = (d: Draft) => d.ea.trim() !== '' || d.pct.trim() !== '';
const trimNumber = (n: number) => String(Math.round(n * 100) / 100);

interface EasyCountProps {
  date: string;
  today: string;
  items: EasyCountItem[];
  readOnly: boolean;
}

export function EasyCount({ date, today, items, readOnly }: EasyCountProps) {
  const { m, locale } = useI18n();
  const t = m.store.easyCount;
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, Draft>>(() => Object.fromEntries(items.map((i) => [i.id, draftOf(i)])));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(saved);
  const [saving, setSaving] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const changed = useMemo(() => items.filter((i) => !sameDraft(drafts[i.id], saved[i.id])), [items, drafts, saved]);
  const doneCount = items.filter((i) => isFilled(drafts[i.id])).length;
  const hadEarlier = items.some((i) => i.current);
  const dirty = changed.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (id: string, patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const focus = (key: string) => {
    const el = inputs.current.get(key);
    el?.focus();
    el?.select();
  };
  const register = (key: string) => (el: HTMLInputElement | null) => {
    if (el) inputs.current.set(key, el);
    else inputs.current.delete(key);
  };

  function goToDate(next: string) {
    if (!next || next === date) return;
    if (dirty && !window.confirm(t.leaveWarning)) return;
    router.push(`/dashboard/store/easy-count?date=${next > today ? today : next}`);
  }

  async function save() {
    const lines = [];
    for (const item of changed) {
      const d = drafts[item.id];
      const ea = d.ea.trim() === '' ? null : Number(d.ea);
      const pct = d.pct.trim() === '' ? null : Number(d.pct);
      if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
        toast.error(t.percentRange);
        focus(`${item.id}:pct`);
        return;
      }
      if (ea !== null && (!Number.isFinite(ea) || ea < 0)) {
        focus(`${item.id}:ea`);
        return;
      }
      lines.push({ itemId: item.id, fullUnits: ea, openedPercent: pct === null ? null : Math.round(pct) });
    }
    if (lines.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/store/counts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, lines }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? t.saveFailed);
      setSaved(drafts);
      if (body.saved) toast.success(format(t.saved, { count: body.saved }));
      if (body.cleared) toast.success(format(t.cleared, { count: body.cleared }));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const dateText = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

  const header = (
    <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <Link href="/dashboard/store" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t.back}
        </Link>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">{t.title}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t.description}</p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="easy-count-date" className="text-xs text-muted-foreground">
          {t.dateLabel}
        </label>
        <input
          id="easy-count-date"
          type="date"
          value={date}
          max={today}
          onChange={(e) => goToDate(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={() => goToDate(today)}
          disabled={date === today}
          className="h-9 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:bg-foreground disabled:text-background"
        >
          {t.today}
        </button>
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="space-y-7">
        {header}
        <DashboardEmptyState title={t.emptyTitle} body={t.emptyBody} href="/settings?tab=store" cta={t.emptyCta} />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-24">
      {header}

      <section aria-label={t.title} className="relative mx-auto max-w-4xl pt-3">
        {/* 아래에 겹친 종이 두 장 — 수첩 한 권처럼 보이게 */}
        <div aria-hidden="true" className={cn('absolute inset-x-4 top-6 -bottom-2.5 rounded-[18px] border border-border', PAPER_EDGE)} />
        <div aria-hidden="true" className={cn('absolute inset-x-2 top-4 -bottom-1.5 rounded-[18px] border border-border', PAPER_EDGE)} />

        <div className={cn('relative rounded-[18px] border border-border', PAPER)}>
          <BinderRings />

          {/* 머리 — 날짜 칸과 진행 정도 */}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-5 pt-9 pb-3 sm:px-8 sm:pl-16">
            <p className="flex items-baseline gap-2">
              <span className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{t.page}</span>
              <span className={cn(hand.className, 'border-b border-foreground/40 px-1 text-2xl leading-none text-foreground tabular-nums')}>{dateText}</span>
            </p>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">{format(t.progress, { done: doneCount, total: items.length })}</span>
              <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-300 ease-out"
                  style={{ width: `${(doneCount / items.length) * 100}%` }}
                />
              </span>
            </div>
          </div>
          {hadEarlier && <p className="px-5 pb-2 text-xs text-muted-foreground sm:px-8 sm:pl-16">{t.savedEarlier}</p>}
          {readOnly && <p className="px-5 pb-2 text-xs text-status-warning sm:px-8 sm:pl-16">{t.readOnly}</p>}

          <div className="relative">
            {/* 붉은 여백선(두 줄) */}
            <div aria-hidden="true" className={cn('absolute inset-y-0 left-11 hidden w-px sm:block', MARGIN_LINE)} />
            <div aria-hidden="true" className={cn('absolute inset-y-0 left-12 hidden w-px sm:block', MARGIN_LINE)} />

            <div
              className={cn(
                'hidden grid-cols-[minmax(0,1fr)_9.5rem_10rem_13rem] items-end gap-x-4 border-b-2 px-8 pb-2 pl-16 text-[11px] font-medium text-muted-foreground sm:grid',
                RULE,
              )}
            >
              <span>{t.columns.item}</span>
              <span>{t.columns.previous}</span>
              <span className="text-center" title={t.eaHint}>
                {t.columns.ea} <span className="font-normal">· {t.eaHint}</span>
              </span>
              <span title={t.openedHint}>
                {t.columns.opened} <span className="font-normal">· {t.openedHint}</span>
              </span>
            </div>

            <ol>
              {items.map((item, index) => (
                <CountRow
                  key={item.id}
                  item={item}
                  draft={drafts[item.id]}
                  changed={!sameDraft(drafts[item.id], saved[item.id])}
                  readOnly={readOnly}
                  register={register}
                  onChange={(patch) => update(item.id, patch)}
                  onNext={(from) => (from === 'ea' ? focus(`${item.id}:pct`) : items[index + 1] ? focus(`${items[index + 1].id}:ea`) : undefined)}
                />
              ))}
            </ol>
            <div className="h-10" aria-hidden="true" />
          </div>
        </div>
      </section>

      {!readOnly && (
        <div className="sticky bottom-4 z-10 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-sidebar py-2 pr-2 pl-5 text-sm text-sidebar-foreground">
          <span className={cn('tabular-nums', !dirty && 'text-sidebar-muted-foreground')} aria-live="polite">
            {dirty ? format(t.unsaved, { count: changed.length }) : t.noChanges}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="h-9 rounded-full bg-brand-accent px-5 font-semibold text-brand-accent-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
      )}
    </div>
  );
}

/** 수첩 윗부분의 스프링 — 종이에 뚫린 구멍과 그 위를 감는 고리. */
function BinderRings() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 -top-3 flex justify-between sm:inset-x-10">
      {Array.from({ length: 18 }, (_, i) => (
        <span key={i} className={cn('relative flex-col items-center', i % 2 === 1 ? 'hidden sm:flex' : 'flex')}>
          <span className="h-7 w-2.5 rounded-full bg-gradient-to-b from-[oklch(0.42_0.01_260)] via-[oklch(0.62_0.008_260)] to-[oklch(0.32_0.012_260)]" />
          <span className="absolute top-[18px] size-2.5 rounded-full bg-background ring-1 ring-border" />
        </span>
      ))}
    </div>
  );
}

interface CountRowProps {
  item: EasyCountItem;
  draft: Draft;
  changed: boolean;
  readOnly: boolean;
  register: (key: string) => (el: HTMLInputElement | null) => void;
  onChange: (patch: Partial<Draft>) => void;
  onNext: (from: 'ea' | 'pct') => void;
}

function CountRow({ item, draft, changed, readOnly, register, onChange, onNext }: CountRowProps) {
  const { m } = useI18n();
  const t = m.store.easyCount;
  const filled = isFilled(draft);
  const prev = item.previous;
  const step = (delta: number) => {
    const current = draft.ea.trim() === '' ? (prev?.fullUnits ?? 0) : Number(draft.ea) || 0;
    onChange({ ea: trimNumber(Math.max(0, Math.floor(current) + delta)) });
  };
  const enterToNext = (from: 'ea' | 'pct') => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onNext(from);
  };
  const fieldClass = cn(
    'h-9 bg-transparent text-center text-base font-semibold tabular-nums text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/45',
    'border-b border-dashed border-foreground/30 focus:border-solid focus:border-foreground disabled:cursor-not-allowed disabled:opacity-60',
  );

  return (
    <li
      className={cn(
        'group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 border-b px-5 py-3.5 transition-colors sm:grid-cols-[minmax(0,1fr)_9.5rem_10rem_13rem] sm:gap-x-4 sm:px-8 sm:py-3 sm:pl-16',
        RULE,
        'focus-within:bg-[oklch(0.97_0.03_110/0.6)]',
      )}
    >
      {/* 여백 칸의 체크 — 이 품목을 적었으면 표시 */}
      <span aria-hidden="true" className="absolute top-1/2 left-4 hidden -translate-y-1/2 sm:block">
        {filled && <Check className={cn('size-4', changed ? 'text-foreground' : 'text-muted-foreground')} strokeWidth={2.5} />}
      </span>

      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">
          <span className="bg-[linear-gradient(transparent_58%,transparent_58%)] bg-no-repeat transition-[background-image] group-focus-within:bg-[linear-gradient(transparent_58%,oklch(0.85_0.19_126/0.55)_58%)]">
            {item.name}
          </span>
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{item.unit}</span>
        </p>
        {item.supplierName && <p className="truncate text-[11px] text-muted-foreground">{item.supplierName}</p>}
      </div>

      {/* 지난 기록 — 연필 손글씨 */}
      <div className="flex items-center justify-end gap-2 sm:justify-start">
        <div className="text-right sm:text-left">
          {prev ? (
            <>
              <p className={cn(hand.className, 'text-xl leading-none text-[oklch(0.45_0.02_260)] tabular-nums')}>
                {trimNumber(prev.fullUnits)} EA{prev.openedPercent != null && <> · {prev.openedPercent}%</>}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{format(t.previousCount, { date: prev.date.slice(5).replace('-', '/') })}</p>
            </>
          ) : item.lastOrder ? (
            <>
              <p className={cn(hand.className, 'text-xl leading-none text-[oklch(0.45_0.02_260)] tabular-nums')}>
                {trimNumber(item.lastOrder.quantity)}
                {item.unit}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{format(t.previousOrder, { date: item.lastOrder.date.slice(5).replace('-', '/') })}</p>
            </>
          ) : (
            <p className={cn(hand.className, 'text-lg leading-none text-muted-foreground/70')}>{t.nothing}</p>
          )}
        </div>
        {prev && !readOnly && (
          <button
            type="button"
            onClick={() => onChange({ ea: trimNumber(prev.fullUnits), pct: prev.openedPercent != null ? String(prev.openedPercent) : '' })}
            aria-label={format(t.sameAsBeforeAria, { name: item.name })}
            className="rounded-full border border-foreground/15 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t.sameAsBefore}
          </button>
        )}
      </div>

      {/* EA — 미개봉 완제품 개수 */}
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:justify-center">
        <span className="w-12 shrink-0 text-[11px] font-medium text-muted-foreground sm:hidden">{t.columns.ea}</span>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={readOnly}
          aria-label={format(t.minus, { name: item.name })}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <input
          ref={register(`${item.id}:ea`)}
          inputMode="decimal"
          value={draft.ea}
          disabled={readOnly}
          placeholder={prev ? trimNumber(prev.fullUnits) : '0'}
          onChange={(e) => onChange({ ea: e.target.value.replace(/[^0-9.]/g, '') })}
          onKeyDown={enterToNext('ea')}
          aria-label={format(t.eaAria, { name: item.name, unit: item.unit })}
          className={cn(fieldClass, 'w-14')}
        />
        <button
          type="button"
          onClick={() => step(1)}
          disabled={readOnly}
          aria-label={format(t.plus, { name: item.name })}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* 잔량 — 개봉한 제품에 남은 양(%) */}
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
        <span className="w-12 shrink-0 text-[11px] font-medium text-muted-foreground sm:hidden">{t.columns.opened}</span>
        <span className="relative">
          <input
            ref={register(`${item.id}:pct`)}
            inputMode="numeric"
            value={draft.pct}
            disabled={readOnly}
            placeholder={prev?.openedPercent != null ? String(prev.openedPercent) : '—'}
            onChange={(e) => onChange({ pct: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
            onKeyDown={enterToNext('pct')}
            aria-label={format(t.openedAria, { name: item.name })}
            className={cn(fieldClass, 'w-14 pr-4')}
          />
          <span className="pointer-events-none absolute top-1/2 right-0.5 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
            %
          </span>
        </span>
        <span className="flex gap-1">
          {QUICK_PERCENTS.map((pct) => {
            const active = draft.pct.trim() === String(pct);
            return (
              <button
                key={pct}
                type="button"
                disabled={readOnly}
                onClick={() => onChange({ pct: active ? '' : String(pct) })}
                aria-pressed={active}
                aria-label={format(t.quickAria, { name: item.name, pct })}
                className={cn(
                  'h-7 min-w-9 rounded-full px-1.5 text-[11px] font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40',
                  active ? 'bg-foreground text-background' : 'border border-foreground/15 text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                )}
              >
                {pct}
              </button>
            );
          })}
        </span>
      </div>
    </li>
  );
}
