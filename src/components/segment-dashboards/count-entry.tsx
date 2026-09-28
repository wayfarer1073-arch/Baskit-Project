'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionPanel, SegmentDashboardHeader } from '@/components/segment-dashboards/dashboard-parts';
import type { RecentCountSku } from '@/domain/segments/read-model';
import { cn } from '@/lib/utils';

interface LotDraft {
  key: number;
  lot: string;
  quantity: string;
}

interface LineDraft {
  key: number;
  /** 최근 목록에서 고른 기존 상품이면 그 상품 — 상품코드를 고정하고 마지막 실사 값을 보여준다. */
  from: RecentCountSku | null;
  productCode: string;
  productName: string;
  quantity: string;
  unitCost: string;
  lots: LotDraft[];
}

let seq = 0;
const nextKey = () => ++seq;
const blankLine = (key = nextKey()): LineDraft => ({ key, from: null, productCode: '', productName: '', quantity: '', unitCost: '', lots: [] });
const num = (v: string) => Number(v.replace(/,/g, ''));

function lineFromSku(sku: RecentCountSku): LineDraft {
  return {
    key: nextKey(),
    from: sku,
    productCode: sku.productCode,
    productName: sku.productName,
    quantity: sku.lastQuantity === null ? '' : String(sku.lastQuantity),
    unitCost: sku.unitCost === null ? '' : String(sku.unitCost),
    lots: sku.lots.map((l) => ({ key: nextKey(), lot: l.lot, quantity: String(l.quantity) })),
  };
}

function lotTotal(line: LineDraft) {
  return line.lots.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}

export function CountEntry({ today, warehouses }: { today: string; warehouses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [lines, setLines] = useState<LineDraft[]>([blankLine(0)]);
  const [recent, setRecent] = useState<RecentCountSku[] | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const loadRecent = useCallback(async (id: string) => {
    setRecent(null);
    const res = await fetch(`/api/count/recent?warehouseId=${id}`);
    const data = await res.json().catch(() => ({ skus: [] }));
    setRecent(res.ok ? data.skus : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (warehouseId) loadRecent(warehouseId);
  }, [warehouseId, loadRecent]);

  const recentByCode = useMemo(() => new Map((recent ?? []).map((s) => [s.productCode, s])), [recent]);
  const inForm = new Set(lines.map((l) => l.productCode.trim()).filter(Boolean));
  const filtered = (recent ?? []).filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.productCode.toLowerCase().includes(q) || s.productName.toLowerCase().includes(q);
  });

  function update(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function updateLot(lineKey: number, lotKey: number, patch: Partial<LotDraft>) {
    setLines((prev) => prev.map((l) => (l.key === lineKey ? { ...l, lots: l.lots.map((x) => (x.key === lotKey ? { ...x, ...patch } : x)) } : l)));
  }

  function pick(sku: RecentCountSku) {
    if (inForm.has(sku.productCode)) {
      document.getElementById(`count-qty-${lines.find((l) => l.productCode === sku.productCode)?.key}`)?.focus();
      return;
    }
    setLines((prev) => {
      // 아무것도 안 적은 빈 줄이 있으면 그 자리를 채운다.
      const emptyIndex = prev.findIndex((l) => !l.productCode && !l.productName && !l.quantity);
      const line = lineFromSku(sku);
      if (emptyIndex >= 0) return prev.map((l, i) => (i === emptyIndex ? line : l));
      return [...prev, line];
    });
  }

  function changeWarehouse(id: string) {
    const touched = lines.some((l) => l.productCode || l.quantity);
    if (touched && !confirm('창고를 바꾸면 적고 있던 내용이 지워져요. 바꿀까요?')) return;
    setWarehouseId(id);
    setLines([blankLine()]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = lines
      .filter((l) => l.productCode.trim() || l.productName.trim() || l.quantity || l.lots.length)
      .map((l) => ({
        productCode: l.productCode.trim(),
        productName: l.productName.trim(),
        quantity: l.lots.length ? lotTotal(l) : num(l.quantity),
        unitCost: l.unitCost.trim() ? num(l.unitCost) : null,
        lots: l.lots.filter((x) => x.lot.trim() || x.quantity).map((x) => ({ lot: x.lot.trim(), quantity: Number(x.quantity) || 0 })),
      }));
    if (payload.length === 0) {
      toast.error('센 상품을 하나 이상 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouseId, date, lines: payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? '저장에 실패했습니다.');
      toast.success(`${date} 실사 ${payload.length}개 상품을 기록했어요.`);
      setLines([blankLine()]);
      loadRecent(warehouseId);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <SegmentDashboardHeader
        title="실사 입력"
        description="이번에 센 상품만 적으면 돼요. 세지 않은 상품은 마지막 실사 값으로 계속 추정해요."
        action={
          <Link href="/upload" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            엑셀로 한 번에 올리기
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SectionPanel title="센 수량" description="롯트별로 셌다면 '롯트 추가'로 나눠 적으세요. 수량은 롯트 합계로 계산돼요.">
          <form onSubmit={submit} className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap items-end gap-3">
              {warehouses.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor="count-warehouse">창고</Label>
                  <Select value={warehouseId} onValueChange={changeWarehouse}>
                    <SelectTrigger id="count-warehouse" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="count-date">실사일</Label>
                <Input id="count-date" type="date" max={today} required value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
              </div>
            </div>

            <ol className="space-y-2">
              {lines.map((line, index) => {
                const known = line.from ?? recentByCode.get(line.productCode.trim()) ?? null;
                const hasLots = line.lots.length > 0;
                return (
                  <li key={line.key} className="rounded-lg border border-border p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1.4fr_0.7fr_0.8fr_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label htmlFor={`count-code-${line.key}`} className="text-xs">
                          상품코드(관리코드)
                        </Label>
                        <Input
                          id={`count-code-${line.key}`}
                          required
                          maxLength={100}
                          value={line.productCode}
                          readOnly={!!line.from}
                          className={cn(line.from && 'bg-muted/60')}
                          onChange={(e) => {
                            const code = e.target.value;
                            const match = recentByCode.get(code.trim());
                            update(line.key, { productCode: code, ...(match && !line.productName ? { productName: match.productName } : {}) });
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`count-name-${line.key}`} className="text-xs">
                          상품명
                        </Label>
                        <Input
                          id={`count-name-${line.key}`}
                          required
                          maxLength={200}
                          value={line.productName}
                          onChange={(e) => update(line.key, { productName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`count-qty-${line.key}`} className="text-xs">
                          재고수량
                        </Label>
                        <Input
                          id={`count-qty-${line.key}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          required={!hasLots}
                          readOnly={hasLots}
                          title={hasLots ? '롯트 합계로 계산돼요' : undefined}
                          className={cn(hasLots && 'bg-muted/60')}
                          value={hasLots ? String(lotTotal(line)) : line.quantity}
                          onChange={(e) => update(line.key, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`count-cost-${line.key}`} className="text-xs">
                          단위원가 (원)
                        </Label>
                        <Input
                          id={`count-cost-${line.key}`}
                          inputMode="decimal"
                          pattern="[0-9,.]*"
                          placeholder={known?.unitCost ? `이전 ${known.unitCost.toLocaleString('ko-KR')}` : '선택'}
                          value={line.unitCost}
                          onChange={(e) => update(line.key, { unitCost: e.target.value })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="col-span-2 size-9 justify-self-end sm:col-span-1"
                        aria-label={`${index + 1}번째 줄 삭제`}
                        disabled={lines.length === 1 && !line.productCode && !line.quantity}
                        onClick={() => setLines((prev) => (prev.length === 1 ? [blankLine()] : prev.filter((l) => l.key !== line.key)))}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>

                    {hasLots && (
                      <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3" aria-label="롯트별 수량">
                        {line.lots.map((lot) => (
                          <li key={lot.key} className="flex items-center gap-2">
                            <Input
                              aria-label="롯트"
                              placeholder="롯트 (예: 250901)"
                              required
                              maxLength={100}
                              value={lot.lot}
                              onChange={(e) => updateLot(line.key, lot.key, { lot: e.target.value })}
                              className="h-8 max-w-44"
                            />
                            <Input
                              aria-label={`${lot.lot || '롯트'} 수량`}
                              type="number"
                              min={0}
                              step={1}
                              required
                              placeholder="수량"
                              value={lot.quantity}
                              onChange={(e) => updateLot(line.key, lot.key, { quantity: e.target.value })}
                              className="h-8 w-24"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={`${lot.lot || '롯트'} 삭제`}
                              onClick={() =>
                                update(line.key, { lots: line.lots.filter((x) => x.key !== lot.key), ...(line.lots.length === 1 ? { quantity: String(lotTotal(line)) } : {}) })
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {known?.lastCountDate
                          ? `마지막 실사 ${known.lastCountDate} · ${known.lastQuantity?.toLocaleString('ko-KR')}개${known.lots.length ? ` (롯트 ${known.lots.length}개)` : ''}`
                          : line.productCode.trim()
                            ? '새 상품 — 이번 실사부터 추적해요'
                            : '최근 센 상품에서 고르거나 새 상품을 적어 주세요'}
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
                        onClick={() =>
                          update(line.key, {
                            lots: [
                              ...(hasLots ? line.lots : line.quantity ? [{ key: nextKey(), lot: '', quantity: line.quantity }] : []),
                              { key: nextKey(), lot: '', quantity: '' },
                            ],
                          })
                        }
                      >
                        <Plus className="size-3" />
                        롯트 추가
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                <Plus className="size-3.5" />새 상품 줄 추가
              </Button>
              <Button type="submit" disabled={saving || !warehouseId}>
                {saving ? '저장 중…' : `실사 기록 (${lines.filter((l) => l.productCode.trim()).length}개)`}
              </Button>
            </div>
          </form>
        </SectionPanel>

        <SectionPanel title="최근 센 상품" description="누르면 마지막 값이 채워져요 · 수량만 고치거나 롯트를 더하세요">
          <div className="border-b border-border px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="최근 센 상품 검색" placeholder="상품코드·상품명 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
            </div>
          </div>
          <ul className="max-h-[560px] divide-y divide-border overflow-y-auto">
            {recent === null &&
              Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="px-4 py-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-1.5 h-3 w-1/2" />
                </li>
              ))}
            {recent?.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">아직 센 상품이 없어요. 왼쪽에 첫 실사를 적어 주세요.</li>}
            {recent && recent.length > 0 && filtered.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">검색 결과가 없어요.</li>}
            {filtered.map((s) => {
              const added = inForm.has(s.productCode);
              return (
                <li key={s.skuId}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    className={cn('w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/50', added && 'bg-brand-accent/5')}
                    aria-pressed={added}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{s.productName}</span>
                      <span className="shrink-0 text-sm tabular-nums">{s.lastQuantity?.toLocaleString('ko-KR') ?? '—'}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {s.productCode}
                        {s.lots.length > 0 && ` · 롯트 ${s.lots.length}`}
                      </span>
                      <span className="shrink-0">{added ? '입력 중' : (s.lastCountDate ?? '')}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </SectionPanel>
      </div>
    </div>
  );
}
