'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel } from '@/components/segment-dashboards/dashboard-parts';
import { MenuSalesUpload } from '@/components/segment-dashboards/menu-sales-upload';
import type { LossReport, RecipeItemRow, RecipeOverview, StoreMenuRow } from '@/domain/segments/read-model';
import type { LossLevel } from '@/domain/segments/loss-report';
import { USAGE_PERIODS } from '@/domain/segments/recipe-usage';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

interface MenuRecipesProps {
  items: RecipeItemRow[];
  menus: StoreMenuRow[];
  overview: RecipeOverview;
  loss: LossReport;
  serverOcr: boolean;
  days: number;
  today: string;
  readOnly: boolean;
}

/** 소수 자릿수를 값 크기에 맞춰 — 1.44봉, 30개, 600 g. */
const amount = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 100) / 100));
/** 레시피를 적는 단위 — 환산이 있으면 g·ml, 없으면 품목 단위. */
const recipeUnit = (item: RecipeItemRow) => item.contentUnit ?? item.unit;

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? '');
  return data;
}

export function MenuRecipes({ items, menus, overview, loss, serverOcr, days, today, readOnly }: MenuRecipesProps) {
  const { m } = useI18n();
  const t = m.store.menus;
  const [editing, setEditing] = useState<string | null>(null);
  const editingMenu = menus.find((menu) => menu.id === editing) ?? null;

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-5">
        <Link href="/dashboard/store" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t.back}
        </Link>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t.description}</p>
      </div>

      <MenuSalesUpload menus={menus} today={today} readOnly={readOnly} serverOcr={serverOcr} />
      <UsagePanel overview={overview} days={days} />
      <LossPanel report={loss} />
      <MenuList menus={menus} items={items} readOnly={readOnly} onEdit={setEditing} />
      <ContentPanel items={items} readOnly={readOnly} />

      <RecipeSheet key={editingMenu?.id ?? 'none'} menu={editingMenu} items={items} readOnly={readOnly} onClose={() => setEditing(null)} />
    </div>
  );
}

// ── 레시피 기반 소모량 ───────────────────────────────────────────────────────────────────────

function UsagePanel({ overview, days }: { overview: RecipeOverview; days: number }) {
  const t = useI18n().m.store.menus.usage;
  const period = (
    <div role="group" aria-label={t.periodAria} className="inline-flex rounded-lg border border-border p-0.5 text-xs">
      {USAGE_PERIODS.map((d) => (
        <Link
          key={d}
          href={`/dashboard/store/menus?days=${d}`}
          scroll={false}
          aria-current={d === days ? 'true' : undefined}
          className={cn('rounded-md px-3 py-1.5 font-medium transition-colors', d === days ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
        >
          {format(t.period, { days: d })}
        </Link>
      ))}
    </div>
  );
  return (
    <SectionPanel title={t.title} description={t.help} action={period}>
      {overview.rows.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">{t.emptyItems}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-4 text-xs text-muted-foreground">
            {overview.salesDays === 0 ? (
              <span className="text-status-warning">{t.noSales}</span>
            ) : (
              <span>{format(t.salesDays, { days: overview.salesDays, date: overview.lastSalesDate ?? '—' })}</span>
            )}
            {overview.menusWithoutRecipe.length > 0 && (
              <span className="text-status-warning">
                {format(t.missingRecipe, { list: overview.menusWithoutRecipe.map((mm) => `${mm.name} ${amount(mm.quantity)}`).join(', ') })}
              </span>
            )}
          </div>
          <div className="overflow-x-auto p-5 pt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.item}</TableHead>
                  <TableHead className="text-right">{t.used}</TableHead>
                  <TableHead className="text-right">{t.daily}</TableHead>
                  <TableHead className="text-right">{t.estimate}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.rows.map((row) => (
                  <TableRow key={row.item.id}>
                    <TableCell className="font-medium">{row.item.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={cn(row.units === 0 && 'text-muted-foreground')}>
                        {amount(row.units)}
                        {row.item.unit}
                      </span>
                      {row.content !== null && row.content > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {amount(row.content)} {row.item.contentUnit}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.dailyAverage === null ? '—' : `${amount(row.dailyAverage)}${row.item.unit}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.estimate ? (
                        <>
                          <span className="font-semibold">
                            {amount(row.estimate.estimatedUnits)}
                            {row.item.unit}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {format(t.estimateDetail, {
                              date: row.estimate.baseDate.slice(5).replace('-', '/'),
                              base: amount(row.estimate.baseUnits),
                              ordered: amount(row.estimate.orderedSince),
                              used: amount(row.estimate.usedSince),
                            })}
                          </span>
                        </>
                      ) : (
                        <Link href="/dashboard/store/easy-count" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                          {t.noCount}
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </SectionPanel>
  );
}

// ── 로스 리포트 ──────────────────────────────────────────────────────────────────────────────

const LEVEL_TONE: Record<LossLevel, string> = {
  check: 'bg-status-danger-bg text-status-danger',
  watch: 'bg-status-warning-bg text-status-warning',
  ok: 'bg-status-normal-bg text-status-normal',
  no_sales: 'bg-muted text-muted-foreground',
};
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${amount(Math.abs(v))}`;
const shortDate = (d: string) => d.slice(5).replace('-', '/');

function LossPanel({ report }: { report: LossReport }) {
  const { m, locale } = useI18n();
  const t = m.store.menus.loss;
  const counts = { check: 0, watch: 0, ok: 0, no_sales: 0 };
  let overValue = 0;
  for (const row of report.rows) {
    counts[row.loss.level]++;
    if (row.unitCost && row.loss.level !== 'ok' && row.loss.difference > 0) overValue += row.loss.difference * row.unitCost;
  }
  const countLink = (
    <Link href="/dashboard/store/easy-count" className="font-medium text-foreground underline-offset-2 hover:underline">
      {t.goCount}
    </Link>
  );

  return (
    <SectionPanel title={t.title} description={t.help}>
      {report.inRecipes === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">{t.noRecipes}</p>
      ) : report.rows.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">
          {t.empty} {countLink}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-4 text-xs text-muted-foreground">
            <span className="tabular-nums">{format(t.summary, counts)}</span>
            {overValue > 0 && <span className="font-medium text-status-danger tabular-nums">{format(t.overValue, { value: formatMoney(overValue, locale) })}</span>}
            {report.waiting > 0 && (
              <span>
                {format(t.waiting, { count: report.waiting })} {countLink}
              </span>
            )}
          </div>
          <ul className="divide-y divide-border px-5 pt-2 sm:hidden">
            {report.rows.map(({ item, unitCost, loss }) => (
              <li key={item.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-medium">{item.name}</span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', LEVEL_TONE[loss.level])}>{t.level[loss.level]}</span>
                </div>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {signed(loss.difference)}
                  {item.unit}
                  {loss.rate !== null && <span className="ml-1 text-xs font-normal text-muted-foreground">({signed(Math.round(loss.rate * 100))}%)</span>}
                  {unitCost !== null && loss.level !== 'ok' && Math.abs(loss.difference) > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {loss.difference > 0 ? '+' : '−'}
                      {formatMoney(Math.abs(loss.difference) * unitCost, locale)}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {t.actual} {amount(loss.actualUsed)}
                  {item.unit} · {t.theoretical} {amount(loss.theoretical)}
                  {item.unit}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {format(t.intervalValue, { from: shortDate(loss.from), to: shortDate(loss.to) })} · {format(t.days, { days: loss.days })}
                  {loss.salesDays < loss.days && <span className="text-status-warning"> · {format(t.salesGap, { sales: loss.salesDays, days: loss.days })}</span>}
                </p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto p-5 pt-3 sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.item}</TableHead>
                  <TableHead>{t.interval}</TableHead>
                  <TableHead className="text-right">{t.actual}</TableHead>
                  <TableHead className="text-right">{t.theoretical}</TableHead>
                  <TableHead className="text-right">{t.difference}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map(({ item, unitCost, loss }) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {format(t.intervalValue, { from: shortDate(loss.from), to: shortDate(loss.to) })}
                      <span className="block text-[11px] text-muted-foreground">
                        {format(t.days, { days: loss.days })}
                        {loss.salesDays < loss.days && <span className="text-status-warning"> · {format(t.salesGap, { sales: loss.salesDays, days: loss.days })}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {amount(loss.actualUsed)}
                      {item.unit}
                      <span className="block text-[11px] whitespace-nowrap text-muted-foreground">
                        {format(t.actualDetail, { start: amount(loss.startUnits), ordered: amount(loss.orderedUnits), end: amount(loss.endUnits) })}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {amount(loss.theoretical)}
                      {item.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <span className="font-semibold whitespace-nowrap">
                          {signed(loss.difference)}
                          {item.unit}
                          {loss.rate !== null && <span className="ml-1 text-xs font-normal text-muted-foreground">({signed(Math.round(loss.rate * 100))}%)</span>}
                        </span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', LEVEL_TONE[loss.level])}>{t.level[loss.level]}</span>
                      </span>
                      {unitCost !== null && loss.level !== 'ok' && Math.abs(loss.difference) > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {loss.difference > 0 ? '+' : '−'}
                          {formatMoney(Math.abs(loss.difference) * unitCost, locale)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </SectionPanel>
  );
}

// ── 메뉴 목록 ────────────────────────────────────────────────────────────────────────────────

function MenuList({ menus, items, readOnly, onEdit }: { menus: StoreMenuRow[]; items: RecipeItemRow[]; readOnly: boolean; onEdit: (id: string) => void }) {
  const t = useI18n().m.store.menus.list;
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const itemById = new Map(items.map((i) => [i.id, i]));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { id } = await send('/api/store/menus', 'POST', { name: name.trim(), code: null });
      toast.success(t.created);
      setName('');
      router.refresh();
      onEdit(id);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  const addForm = readOnly ? null : (
    <form onSubmit={add} className="flex w-full items-center gap-2 sm:w-auto">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t.addPlaceholder}
        aria-label={t.addPlaceholder}
        className="h-8 w-full text-sm sm:w-60"
        maxLength={100}
      />
      <Button type="submit" size="sm" disabled={busy || !name.trim()}>
        <Plus aria-hidden="true" />
        {t.add}
      </Button>
    </form>
  );

  return (
    <SectionPanel title={t.title} description={t.help} action={addForm}>
      {menus.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {menus.map((menu) => (
            <li key={menu.id}>
              <button
                type="button"
                onClick={() => onEdit(menu.id)}
                className="flex w-full flex-col gap-1 px-5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                aria-label={`${t.edit}: ${menu.name}`}
              >
                <span className="min-w-0">
                  <span className="font-medium">{menu.name}</span>
                  {menu.code && <span className="ml-1.5 text-xs text-muted-foreground">{menu.code}</span>}
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {menu.lines.length === 0 ? (
                      <span className="text-status-warning">{t.noRecipe}</span>
                    ) : (
                      menu.lines
                        .map((l) => {
                          const item = itemById.get(l.itemId);
                          return item ? `${item.name} ${amount(l.quantity)}${recipeUnit(item)}` : null;
                        })
                        .filter(Boolean)
                        .join(' · ')
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{format(t.recent, { qty: amount(menu.soldRecent) })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

// ── 레시피 편집 ──────────────────────────────────────────────────────────────────────────────

interface DraftLine {
  key: number;
  itemId: string;
  quantity: string;
}
let lineKey = 0;

function RecipeSheet({ menu, items, readOnly, onClose }: { menu: StoreMenuRow | null; items: RecipeItemRow[]; readOnly: boolean; onClose: () => void }) {
  const { m } = useI18n();
  const t = m.store.menus.recipe;
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>(() => (menu?.lines ?? []).map((l) => ({ key: ++lineKey, itemId: l.itemId, quantity: String(l.quantity) })));
  const [name, setName] = useState(menu?.name ?? '');
  const [code, setCode] = useState(menu?.code ?? '');
  const [busy, setBusy] = useState(false);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const used = new Set(lines.map((l) => l.itemId));

  async function run(action: () => Promise<unknown>, success: string, close = false) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
      if (close) onClose();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : m.store.menus.list.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!menu) return null;
  const valid = lines.every((l) => l.itemId && Number(l.quantity) > 0);
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{format(t.title, { name: menu.name })}</SheetTitle>
          <SheetDescription>{t.description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <div className="space-y-2">
            {lines.map((line) => {
              const item = itemById.get(line.itemId);
              return (
                <div key={line.key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Select
                      value={line.itemId || undefined}
                      onValueChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, itemId: v } : l)))}
                      disabled={readOnly}
                    >
                      <SelectTrigger className="h-9 min-w-0 flex-1 text-sm" aria-label={t.item}>
                        <SelectValue placeholder={t.pickItem} />
                      </SelectTrigger>
                      <SelectContent>
                        {items
                          .filter((i) => i.id === line.itemId || !used.has(i.id))
                          .map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <span className="relative">
                      <Input
                        inputMode="decimal"
                        value={line.quantity}
                        disabled={readOnly}
                        onChange={(e) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value.replace(/[^0-9.]/g, '') } : l)))}
                        aria-label={t.quantity}
                        className="h-9 w-28 pr-9 text-right tabular-nums"
                      />
                      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{item ? recipeUnit(item) : ''}</span>
                    </span>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        aria-label={format(t.removeLine, { name: item?.name ?? '' })}
                        className="size-9 shrink-0 text-muted-foreground"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {item && !item.contentUnit && <p className="text-[11px] text-muted-foreground">{format(t.convertHint, { item: item.name, unit: item.unit })}</p>}
                </div>
              );
            })}
            {!readOnly && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, { key: ++lineKey, itemId: '', quantity: '' }])}
                  disabled={used.size >= items.length}
                >
                  <Plus aria-hidden="true" />
                  {t.addLine}
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !valid}
                  onClick={() =>
                    run(() => send(`/api/store/menus/${menu.id}/recipe`, 'PUT', { lines: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) })) }), t.saved, true)
                  }
                >
                  {t.save}
                </Button>
              </div>
            )}
          </div>

          {!readOnly && (
            <div className="space-y-3 border-t border-border pt-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  {t.name}
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-9 text-sm text-foreground" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  {t.code}
                  <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={50} className="h-9 text-sm text-foreground" />
                </label>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => window.confirm(format(t.archiveConfirm, { name: menu.name })) && run(() => send(`/api/store/menus/${menu.id}`, 'DELETE'), t.archived, true)}
                >
                  {t.archive}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !name.trim() || (name.trim() === menu.name && (code.trim() || null) === menu.code)}
                  onClick={() => run(() => send(`/api/store/menus/${menu.id}`, 'PATCH', { name: name.trim(), code: code.trim() || null }), t.renamed)}
                >
                  {t.rename}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── 품목 환산 ────────────────────────────────────────────────────────────────────────────────

function ContentPanel({ items, readOnly }: { items: RecipeItemRow[]; readOnly: boolean }) {
  const t = useI18n().m.store.menus.content;
  if (items.length === 0) return null;
  return (
    <SectionPanel title={t.title} description={t.help}>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <ContentRow key={`${item.id}:${item.contentPerUnit}:${item.contentUnit}`} item={item} readOnly={readOnly} />
        ))}
      </ul>
    </SectionPanel>
  );
}

function ContentRow({ item, readOnly }: { item: RecipeItemRow; readOnly: boolean }) {
  const t = useI18n().m.store.menus.content;
  const router = useRouter();
  const [value, setValue] = useState(item.contentPerUnit ? String(item.contentPerUnit) : '');
  const [unit, setUnit] = useState(item.contentUnit ?? '');
  const [busy, setBusy] = useState(false);
  const changed = value !== (item.contentPerUnit ? String(item.contentPerUnit) : '') || unit !== (item.contentUnit ?? '');

  async function save(clear = false) {
    setBusy(true);
    try {
      await send(`/api/store/items/${item.id}/content`, 'PATCH', clear ? { contentPerUnit: null, contentUnit: null } : { contentPerUnit: Number(value), contentUnit: unit.trim() });
      toast.success(t.saved);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5">
      <span className="min-w-28 flex-1 font-medium">{item.name}</span>
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-sm text-muted-foreground">{format(t.per, { unit: item.unit })}</span>
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
          disabled={readOnly}
          aria-label={`${item.name} ${t.amount}`}
          className="h-8 w-24 text-right tabular-nums"
        />
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          disabled={readOnly}
          placeholder={t.unitPlaceholder}
          aria-label={`${item.name} ${t.unit}`}
          className="h-8 w-16"
          maxLength={10}
        />
      </span>
      {!readOnly && (
        <span className="flex gap-1">
          <Button size="sm" variant="outline" disabled={busy || !changed || !(Number(value) > 0) || !unit.trim()} onClick={() => save()}>
            {t.save}
          </Button>
          {item.contentPerUnit && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(true)} className="text-muted-foreground">
              {t.clear}
            </Button>
          )}
        </span>
      )}
    </li>
  );
}
