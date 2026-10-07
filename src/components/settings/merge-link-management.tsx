'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Link2, Link2Off } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { SkuPicker, type PickedSku } from '@/components/settings/sku-picker';
import { Paged } from '@/components/ui/paged';
import { cn } from '@/lib/utils';

export interface MergeLinkView {
  skuId: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  mergeKey: string;
  /** 묶음의 기준 품목(다른 창고 품목들이 여기에 묶여 있다). */
  anchor: boolean;
}

async function putMerge(skuId: string, targetSkuId: string | null) {
  const res = await fetch(`/api/sku/${skuId}/merge`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetSkuId }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error);
}

/** 창고마다 코드가 다른 같은 품목을 묶는다. 상품코드가 같으면 따로 묶지 않아도 대시보드의 '창고 합쳐 보기'에서 합쳐진다. */
export function MergeLinkManagement({ links, warehouses, isAdmin }: { links: MergeLinkView[]; warehouses: { id: string; name: string }[]; isAdmin: boolean }) {
  const { m } = useI18n();
  const t = m.mergeLinks;
  const router = useRouter();
  const [source, setSource] = useState<PickedSku | null>(null);
  const [target, setTarget] = useState<PickedSku | null>(null);
  const [busy, setBusy] = useState(false);
  // 묶은 뒤 검색 칸과 결과 목록을 처음 상태로 되돌린다.
  const [formKey, setFormKey] = useState(0);
  const groups = useMemo(() => {
    const map = new Map<string, MergeLinkView[]>();
    for (const l of links) map.set(l.mergeKey, [...(map.get(l.mergeKey) ?? []), l]);
    // 기준 품목을 맨 위에, 그 아래 묶인 품목들.
    return [...map.entries()].map(([key, members]) => [key, [...members].sort((a, b) => Number(b.anchor) - Number(a.anchor))] as const);
  }, [links]);

  const nameOf = (warehouseId: string) => warehouses.find((w) => w.id === warehouseId)?.name ?? '';

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <Paged items={groups} pagerClassName="mt-2">
            {(pageItems) => (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {pageItems.map(([key, members]) => (
                  <li key={key} className="space-y-1.5 px-3 py-2.5 text-sm">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Link2 className="size-3.5" aria-hidden="true" />
                      {format(t.groupSummary, { count: new Set(members.map((l) => l.warehouseName)).size })}
                    </p>
                    {members.map((l) => (
                      <div key={l.skuId} className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">{l.warehouseName}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <code className="text-xs">{l.productCode}</code> {l.productName}
                        </span>
                        {l.anchor && <span className="shrink-0 text-[11px] text-muted-foreground">{t.anchor}</span>}
                        {isAdmin && !l.anchor && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label={format(t.unlink, { code: l.productCode })}
                            disabled={busy}
                            onClick={() => run(() => putMerge(l.skuId, null), t.unlinked)}
                          >
                            <Link2Off className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        )}
        {isAdmin && (
          <form
            className="space-y-2 border-t pt-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!source || !target) return;
              if (await run(() => putMerge(source.skuId, target.skuId), t.linked)) {
                setSource(null);
                setTarget(null);
                setFormKey((k) => k + 1);
              }
            }}
          >
            <SkuPicker
              key={`s${formKey}`}
              id="merge-source"
              label={t.source}
              warehouseLabel={t.warehouse}
              placeholder={t.search}
              warehouses={warehouses}
              value={source}
              onChange={setSource}
            />
            <SkuPicker
              key={`t${formKey}`}
              id="merge-target"
              label={t.target}
              warehouseLabel={t.warehouse}
              placeholder={t.search}
              warehouses={warehouses}
              value={target}
              onChange={setTarget}
            />
            {source && target && (
              <p
                className={cn(
                  'flex flex-wrap items-center gap-1.5 rounded-md px-3 py-2 text-xs',
                  source.warehouseId === target.warehouseId ? 'bg-status-warning-bg text-status-warning' : 'bg-muted/60',
                )}
              >
                {source.warehouseId === target.warehouseId ? (
                  t.sameWarehouse
                ) : (
                  <>
                    <span className="font-medium">
                      {nameOf(source.warehouseId)} {source.productCode} {source.productName}
                    </span>
                    <ArrowLeftRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium">
                      {nameOf(target.warehouseId)} {target.productCode} {target.productName}
                    </span>
                    <span className="text-muted-foreground">{t.preview}</span>
                  </>
                )}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !source || !target || source.warehouseId === target.warehouseId}>
                {t.link}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
