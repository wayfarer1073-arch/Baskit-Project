'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OptionList, useOptionListOpen } from '@/components/ui/option-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Paged } from '@/components/ui/paged';

export interface CostRowView {
  skuId: string;
  warehouseId: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  unitCost: number;
  source: 'FILE' | 'MANUAL' | null;
}

interface SkuOption {
  skuId: string;
  productCode: string;
  productName: string;
}

async function putCost(skuId: string, unitCost: number | null) {
  const res = await fetch(`/api/sku/${skuId}/cost`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitCost }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error);
}

/** 원가가 등록된 품목 목록과 직접 등록·수정·삭제(관리자). */
export function CostManagement({ costs, warehouses, isAdmin }: { costs: CostRowView[]; warehouses: { id: string; name: string }[]; isAdmin: boolean }) {
  const { m } = useI18n();
  const t = m.costs;
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SkuOption[]>([]);
  const optionList = useOptionListOpen();
  const [target, setTarget] = useState<SkuOption | null>(null);
  const [newCost, setNewCost] = useState('');

  useEffect(() => {
    if (!warehouseId || query.trim().length < 1 || target) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/sku/search?warehouseId=${encodeURIComponent(warehouseId)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data) => setOptions(data.results ?? []))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [warehouseId, query, target]);

  // 창고가 하나여도 매장 품목(창고 목록에 없는 가상 창고)이 섞여 있으면 어느 쪽 품목인지 보여 준다.
  const showWarehouse = warehouses.length > 1 || costs.some((c) => !warehouses.some((w) => w.id === c.warehouseId));
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? costs.filter((c) => c.productCode.toLowerCase().includes(q) || c.productName.toLowerCase().includes(q)) : costs;
  }, [costs, filter]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (await run(() => putCost(target.skuId, Number(newCost)), t.saved)) {
      setTarget(null);
      setQuery('');
      setNewCost('');
      setOptions([]);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {costs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Input aria-label={t.filter} placeholder={t.filter} value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 max-w-xs" />
              <span className="text-xs text-muted-foreground">{format(t.count, { count: visible.length })}</span>
            </div>
            <Paged items={visible} resetKey={filter} pagerClassName="mt-2">
              {(pageItems) => (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {pageItems.map((c) => {
                    const draft = drafts[c.skuId] ?? String(c.unitCost);
                    return (
                      <li key={c.skuId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            <code className="text-xs">{c.productCode}</code> {c.productName}
                          </span>
                          {showWarehouse && <span className="text-xs text-muted-foreground">{c.warehouseName}</span>}
                        </span>
                        {c.source && <Badge variant={c.source === 'MANUAL' ? 'notice' : 'secondary'}>{t.source[c.source]}</Badge>}
                        {isAdmin ? (
                          <>
                            <Input
                              aria-label={`${c.productName} ${t.unitCost}`}
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              value={draft}
                              onChange={(e) => setDrafts((p) => ({ ...p, [c.skuId]: e.target.value }))}
                              className="h-8 w-28 text-right tabular-nums"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || draft.trim() === '' || Number(draft) === c.unitCost}
                              onClick={() => run(() => putCost(c.skuId, Number(draft)), t.saved)}
                            >
                              {t.save}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              aria-label={`${c.productName} ${t.remove}`}
                              disabled={busy}
                              onClick={() => confirm(format(t.removeConfirm, { name: c.productName })) && run(() => putCost(c.skuId, null), t.removed)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <span className="tabular-nums">{c.unitCost.toLocaleString()}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Paged>
          </>
        )}

        {isAdmin && warehouses.length > 0 && (
          <form onSubmit={add} className="grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-[auto_1.6fr_1fr_auto] sm:items-start">
            {warehouses.length > 1 ? (
              <div className="space-y-1">
                <Label className="text-xs">{t.warehouse}</Label>
                <Select
                  value={warehouseId}
                  onValueChange={(v) => {
                    setWarehouseId(v);
                    setTarget(null);
                    setOptions([]);
                  }}
                >
                  <SelectTrigger className="h-9 w-36">
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
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="relative space-y-1">
              <Label htmlFor="cost-target" className="text-xs">
                {t.product}
              </Label>
              <Input
                id="cost-target"
                autoComplete="off"
                placeholder={t.searchPlaceholder}
                value={target ? `${target.productCode} · ${target.productName}` : query}
                onChange={(e) => {
                  setTarget(null);
                  setQuery(e.target.value);
                }}
                aria-autocomplete="list"
                aria-controls="cost-target-options"
                {...optionList.inputProps}
              />
              {optionList.focused && !target && options.length > 0 && query.trim() && (
                <OptionList id="cost-target-options">
                  {options.map((o) => (
                    <li key={o.skuId} role="option" aria-selected={false}>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                        {...optionList.optionProps}
                        onClick={() => {
                          setTarget(o);
                          setOptions([]);
                          optionList.close();
                        }}
                      >
                        <code className="text-xs">{o.productCode}</code> {o.productName}
                      </button>
                    </li>
                  ))}
                </OptionList>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-value" className="text-xs">
                {t.unitCost}
              </Label>
              <Input
                id="cost-value"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                required
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
                className="text-right"
              />
            </div>
            <Button type="submit" className="sm:mt-5" disabled={busy || !target || newCost.trim() === ''}>
              {t.add}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
