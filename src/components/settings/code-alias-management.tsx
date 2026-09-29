'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

export interface CodeAliasView {
  id: string;
  warehouseId: string;
  warehouseName: string;
  externalCode: string;
  productCode: string;
  productName: string;
}

interface SkuOption {
  skuId: string;
  productCode: string;
  productName: string;
}

/** 파일의 다른 상품코드를 창고의 기존 상품에 잇는다(업체 코드 변경, 바코드 내보내기 등). */
export function CodeAliasManagement({ aliases, warehouses }: { aliases: CodeAliasView[]; warehouses: { id: string; name: string }[] }) {
  const { m } = useI18n();
  const t = m.codeAliases;
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [externalCode, setExternalCode] = useState('');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SkuOption[]>([]);
  const [target, setTarget] = useState<SkuOption | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function send(url: string, init: RequestInit, success: string) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? t.failed);
      toast.success(success);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    const ok = await send(
      '/api/code-aliases',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouseId, externalCode, skuId: target.skuId }) },
      t.added,
    );
    if (ok) {
      setExternalCode('');
      setQuery('');
      setTarget(null);
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
        {aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {aliases.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                {warehouses.length > 1 && <span className="text-xs text-muted-foreground">{a.warehouseName}</span>}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.externalCode}</code>
                <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  <code className="text-xs">{a.productCode}</code> {a.productName}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-7"
                  aria-label={format(t.removeLabel, { code: a.externalCode })}
                  disabled={busy}
                  onClick={() => send(`/api/code-aliases/${a.id}`, { method: 'DELETE' }, t.removed)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {warehouses.length > 0 && (
          <form onSubmit={add} className="grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-[auto_1fr_1.4fr_auto] sm:items-end">
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
                  <SelectTrigger className="h-9 w-40">
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
            <div className="space-y-1">
              <Label htmlFor="alias-external" className="text-xs">
                {t.externalCode}
              </Label>
              <Input id="alias-external" required maxLength={100} value={externalCode} onChange={(e) => setExternalCode(e.target.value)} />
            </div>
            <div className="relative space-y-1">
              <Label htmlFor="alias-target" className="text-xs">
                {t.target}
              </Label>
              <Input
                id="alias-target"
                autoComplete="off"
                placeholder={t.searchPlaceholder}
                value={target ? `${target.productCode} · ${target.productName}` : query}
                onChange={(e) => {
                  setTarget(null);
                  setQuery(e.target.value);
                }}
                aria-autocomplete="list"
                aria-controls="alias-target-options"
              />
              {!target && options.length > 0 && query.trim() && (
                <ul
                  id="alias-target-options"
                  role="listbox"
                  className="absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md"
                >
                  {options.map((o) => (
                    <li key={o.skuId} role="option" aria-selected={false}>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setTarget(o);
                          setOptions([]);
                        }}
                      >
                        <code className="text-xs">{o.productCode}</code> {o.productName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button type="submit" disabled={busy || !target || !externalCode.trim()}>
              {t.add}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
