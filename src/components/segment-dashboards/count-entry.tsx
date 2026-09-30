'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { SectionPanel, SegmentDashboardHeader } from '@/components/segment-dashboards/dashboard-parts';
import type { CountLot, CountSheetRow } from '@/domain/segments/read-model';
import { usePaged } from '@/lib/use-paged';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface LotDraft {
  key: number;
  lot: string;
  quantity: string;
}

/** 표에서 고친 한 상품 — 수량만 적었거나, 롯트별로 나눠 적었거나. */
interface RowEdit {
  quantity: string;
  lots: LotDraft[] | null;
}

/** 표에 없는 새 상품 한 줄. */
interface NewLine {
  key: number;
  productCode: string;
  productName: string;
  quantity: string;
  unitCost: string;
}

let seq = 0;
const nextKey = () => ++seq;
const blankLine = (): NewLine => ({ key: nextKey(), productCode: '', productName: '', quantity: '', unitCost: '' });
const num = (v: string) => Number(v.replace(/,/g, ''));
const lotDrafts = (lots: CountLot[]): LotDraft[] => lots.map((l) => ({ key: nextKey(), lot: l.lot, quantity: String(l.quantity) }));
const lotTotal = (lots: LotDraft[]) => lots.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
const isChanged = (edit: RowEdit | undefined) => !!edit && (edit.lots !== null || edit.quantity.trim() !== '');

/**
 * 실사 입력 — 창고에서 인식한 상품(엑셀·직접 입력)을 그 날짜 기준 재고 현황 표로 보여주고, 센 수량을 표에서 바로
 * 적거나 고친다. 지난 날짜도 같은 표로 고칠 수 있다(저장하면 그 날짜 실사에 합쳐짐). 표에 없는 상품은 아래에서 추가한다.
 */
export function CountEntry({
  today,
  warehouses,
  fixedDate,
  onSaved,
}: {
  today: string;
  warehouses: { id: string; name: string }[];
  fixedDate?: string;
  onSaved?: () => void;
}) {
  const { m } = useI18n();
  const t = m.periodic.entry;
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [date, setDate] = useState(fixedDate ?? today);
  const [sheet, setSheet] = useState<CountSheetRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [saving, setSaving] = useState(false);

  const loadSheet = useCallback(async (id: string, day: string) => {
    setSheet(null);
    const res = await fetch(`/api/count/sheet?warehouseId=${id}&date=${day}`);
    const data = await res.json().catch(() => ({ rows: [] }));
    setSheet(res.ok ? data.rows : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (warehouseId && date) loadSheet(warehouseId, date);
  }, [warehouseId, date, loadSheet]);

  const filtered = useMemo(() => {
    const q = query.replace(/\s+/g, '').toLowerCase();
    const rows = sheet ?? [];
    return q ? rows.filter((r) => `${r.productCode}${r.productName}`.replace(/\s+/g, '').toLowerCase().includes(q)) : rows;
  }, [sheet, query]);
  const { page, totalPages, pageItems, setPage } = usePaged(filtered, `${warehouseId}|${date}|${query}`);

  const changedCodes = Object.keys(edits).filter((code) => isChanged(edits[code]));
  const filledNewLines = newLines.filter((l) => l.productCode.trim() || l.productName.trim() || l.quantity);
  const pendingCount = changedCodes.length + filledNewLines.length;
  const knownCodes = useMemo(() => new Set((sheet ?? []).map((r) => r.productCode)), [sheet]);

  function setEdit(code: string, patch: Partial<RowEdit>) {
    setEdits((prev) => ({ ...prev, [code]: { quantity: prev[code]?.quantity ?? '', lots: prev[code]?.lots ?? null, ...patch } }));
  }

  function revert(code: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  }

  /** 롯트로 입력: 그날 기록된 롯트 → 직전 실사 롯트 → 빈 롯트 한 줄 순으로 채워서 연다. */
  function openLots(row: CountSheetRow) {
    const base = row.day?.lots.length ? row.day.lots : (row.previous?.lots ?? []);
    setEdit(row.productCode, { lots: base.length ? lotDrafts(base) : [{ key: nextKey(), lot: '', quantity: edits[row.productCode]?.quantity ?? '' }] });
  }

  function updateLot(code: string, lotKey: number, patch: Partial<LotDraft>) {
    const lots = edits[code]?.lots ?? [];
    setEdit(code, { lots: lots.map((l) => (l.key === lotKey ? { ...l, ...patch } : l)) });
  }

  function changeWarehouse(id: string) {
    if (pendingCount > 0 && !confirm(t.changeWarehouseConfirm)) return;
    setWarehouseId(id);
    setEdits({});
    setNewLines([]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const byCode = new Map((sheet ?? []).map((r) => [r.productCode, r]));
    const lotsPayload = (lots: LotDraft[]) => lots.filter((x) => x.lot.trim() || x.quantity).map((x) => ({ lot: x.lot.trim(), quantity: Number(x.quantity) || 0 }));
    const payload = [
      ...changedCodes.map((code) => {
        const row = byCode.get(code)!;
        const edit = edits[code];
        return {
          productCode: code,
          productName: row.productName,
          quantity: edit.lots ? lotTotal(edit.lots) : num(edit.quantity),
          // 원가는 여기서 고치지 않는다 — 그날 기록된 원가, 없으면 상품에 기억된 원가를 그대로 둔다.
          unitCost: row.day?.unitCost ?? row.unitCost,
          lots: edit.lots ? lotsPayload(edit.lots) : [],
        };
      }),
      ...filledNewLines.map((l) => ({
        productCode: l.productCode.trim(),
        productName: l.productName.trim(),
        quantity: num(l.quantity),
        unitCost: l.unitCost.trim() ? num(l.unitCost) : null,
        lots: [],
      })),
    ];
    if (payload.length === 0) {
      toast.error(t.needOne);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouseId, date, lines: payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.saveFailed);
      toast.success(format(t.saved, { date, count: payload.length }));
      setEdits({});
      setNewLines([]);
      loadSheet(warehouseId, date);
      router.refresh();
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const sourceBadge = (source: 'manual' | 'excel') => (
    <Badge variant={source === 'manual' ? 'increase' : 'outline'} className="px-1.5 py-0 text-[10px]">
      {source === 'manual' ? t.sourceManual : t.sourceExcel}
    </Badge>
  );

  return (
    <div className="space-y-6">
      {!fixedDate && (
        <SegmentDashboardHeader
          title={t.title}
          description={t.description}
          action={
            <Link href="/upload" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              {t.excel}
            </Link>
          }
        />
      )}

      <form onSubmit={submit} className="space-y-4">
        <SectionPanel
          title={format(t.sheetTitle, { date })}
          description={t.sheetDescription}
          action={
            <>
              {warehouses.length > 1 && (
                <Select value={warehouseId} onValueChange={changeWarehouse}>
                  <SelectTrigger aria-label={t.warehouse} className="h-8 w-40 text-sm">
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
              )}
              {!fixedDate && (
                <Input
                  type="date"
                  aria-label={t.date}
                  max={today}
                  required
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setEdits({});
                  }}
                  className="h-8 w-40"
                />
              )}
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input aria-label={t.searchAria} placeholder={t.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 w-48 pl-8 text-sm" />
              </div>
            </>
          }
        >
          {date < today && <p className="border-b border-border bg-status-warning-bg px-5 py-2 text-xs text-status-warning">{t.pastDate}</p>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colProduct}</TableHead>
                  <TableHead>{t.colDay}</TableHead>
                  <TableHead>{t.colPrevious}</TableHead>
                  <TableHead className="w-44">{t.colInput}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet === null &&
                  Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-4 w-2/3" />
                      </TableCell>
                    </TableRow>
                  ))}
                {sheet?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm whitespace-normal text-muted-foreground">
                      {t.sheetEmpty}
                    </TableCell>
                  </TableRow>
                )}
                {sheet && sheet.length > 0 && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      {t.sheetNoMatch}
                    </TableCell>
                  </TableRow>
                )}
                {pageItems.map((row) => {
                  const edit = edits[row.productCode];
                  const changed = isChanged(edit);
                  const lots = edit?.lots ?? null;
                  const knownLots = row.day?.lots.length || row.previous?.lots.length || 0;
                  const placeholder = String(row.day?.quantity ?? row.previous?.quantity ?? '');
                  return (
                    <Fragment key={row.skuId}>
                      <TableRow className={cn(changed && 'bg-brand-accent/10 hover:bg-brand-accent/15')}>
                        <TableCell className="max-w-64">
                          <p className="truncate text-sm font-medium" title={row.productName}>
                            {row.productName}
                          </p>
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="tabular-nums">{row.productCode}</span>
                            {row.soldOut && (
                              <Badge variant="soldout" className="px-1.5 py-0 text-[10px]">
                                {t.soldOut}
                              </Badge>
                            )}
                            {changed && <span className="font-medium text-foreground">· {t.changed}</span>}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.day ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-medium tabular-nums">{row.day.quantity.toLocaleString()}</span>
                              {sourceBadge(row.day.source)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t.notCounted}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.previous ? (
                            <span className="tabular-nums">
                              {row.previous.quantity.toLocaleString()}
                              <span className="ml-1.5 text-xs">{row.previous.date}</span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              aria-label={format(t.inputAria, { name: row.productName })}
                              placeholder={placeholder}
                              readOnly={!!lots}
                              title={lots ? t.lotSum : undefined}
                              className={cn('h-8 w-24', lots && 'bg-muted/60')}
                              value={lots ? String(lotTotal(lots)) : (edit?.quantity ?? '')}
                              onChange={(e) => setEdit(row.productCode, { quantity: e.target.value })}
                            />
                            {!lots && (
                              <button
                                type="button"
                                onClick={() => openLots(row)}
                                className="text-[11px] whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                              >
                                {knownLots > 0 ? format(t.lotsOpen, { count: knownLots }) : t.lotsAdd}
                              </button>
                            )}
                            {changed && (
                              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={format(t.revert, { name: row.productName })} onClick={() => revert(row.productCode)}>
                                <RotateCcw className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {lots && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={4}>
                            <ul className="space-y-1.5 border-l-2 border-border pl-3" aria-label={t.lotsAria}>
                              {lots.map((lot) => (
                                <li key={lot.key} className="flex items-center gap-2">
                                  <Input
                                    aria-label={t.lot}
                                    placeholder={t.lotPlaceholder}
                                    required
                                    maxLength={100}
                                    value={lot.lot}
                                    onChange={(e) => updateLot(row.productCode, lot.key, { lot: e.target.value })}
                                    className="h-8 max-w-44"
                                  />
                                  <Input
                                    aria-label={format(t.lotQuantity, { lot: lot.lot || t.lot })}
                                    type="number"
                                    min={0}
                                    step={1}
                                    required
                                    placeholder={t.qtyPlaceholder}
                                    value={lot.quantity}
                                    onChange={(e) => updateLot(row.productCode, lot.key, { quantity: e.target.value })}
                                    className="h-8 w-24"
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    aria-label={format(t.lotDelete, { lot: lot.lot || t.lot })}
                                    onClick={() => {
                                      const rest = lots.filter((x) => x.key !== lot.key);
                                      setEdit(row.productCode, rest.length ? { lots: rest } : { lots: null, quantity: '' });
                                    }}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </li>
                              ))}
                              <li>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                                  onClick={() => setEdit(row.productCode, { lots: [...lots, { key: nextKey(), lot: '', quantity: '' }] })}
                                >
                                  <Plus className="size-3" />
                                  {t.addLot}
                                </button>
                              </li>
                            </ul>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination className="border-t border-border px-5 py-2.5" page={page} totalPages={totalPages} onChange={setPage} />
        </SectionPanel>

        <SectionPanel title={t.newTitle} description={t.newDescription}>
          <div className="space-y-2 px-5 py-4">
            {newLines.map((line, index) => {
              const duplicate = knownCodes.has(line.productCode.trim());
              const patch = (p: Partial<NewLine>) => setNewLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, ...p } : l)));
              return (
                <div key={line.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1.4fr_0.7fr_0.8fr_auto] sm:items-end">
                  <div className="space-y-1">
                    <Label htmlFor={`new-code-${line.key}`} className="text-xs">
                      {t.code}
                    </Label>
                    <Input id={`new-code-${line.key}`} required maxLength={100} value={line.productCode} aria-invalid={duplicate} onChange={(e) => patch({ productCode: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`new-name-${line.key}`} className="text-xs">
                      {t.name}
                    </Label>
                    <Input id={`new-name-${line.key}`} required maxLength={200} value={line.productName} onChange={(e) => patch({ productName: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`new-qty-${line.key}`} className="text-xs">
                      {t.quantity}
                    </Label>
                    <Input
                      id={`new-qty-${line.key}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      required
                      value={line.quantity}
                      onChange={(e) => patch({ quantity: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`new-cost-${line.key}`} className="text-xs">
                      {t.unitCost}
                    </Label>
                    <Input
                      id={`new-cost-${line.key}`}
                      inputMode="decimal"
                      pattern="[0-9,.]*"
                      placeholder={t.optional}
                      value={line.unitCost}
                      onChange={(e) => patch({ unitCost: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-span-2 size-9 justify-self-end sm:col-span-1"
                    aria-label={format(t.deleteLine, { index: index + 1 })}
                    onClick={() => setNewLines((prev) => prev.filter((l) => l.key !== line.key))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setNewLines((prev) => [...prev, blankLine()])}>
              <Plus className="size-3.5" />
              {t.addLine}
            </Button>
          </div>
        </SectionPanel>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !warehouseId || pendingCount === 0}>
            {saving ? t.saving : format(t.submit, { count: pendingCount })}
          </Button>
        </div>
      </form>
    </div>
  );
}
