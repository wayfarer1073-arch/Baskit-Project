'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2Off } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { SkuPicker, type PickedSku } from '@/components/settings/sku-picker';
import { Paged } from '@/components/ui/paged';

export interface MergeLinkView {
  skuId: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  mergeKey: string;
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
  const groups = useMemo(() => {
    const map = new Map<string, MergeLinkView[]>();
    for (const l of links) map.set(l.mergeKey, [...(map.get(l.mergeKey) ?? []), l]);
    return [...map.entries()];
  }, [links]);

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
                  <li key={key} className="space-y-1 px-3 py-2 text-sm">
                    <p className="text-xs text-muted-foreground">{format(t.groupLabel, { key })}</p>
                    {members.map((l) => (
                      <div key={l.skuId} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{l.warehouseName}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <code className="text-xs">{l.productCode}</code> {l.productName}
                        </span>
                        {isAdmin && (
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
              }
            }}
          >
            <SkuPicker id="merge-source" label={t.source} warehouseLabel={t.warehouse} placeholder={t.search} warehouses={warehouses} value={source} onChange={setSource} />
            <SkuPicker id="merge-target" label={t.target} warehouseLabel={t.warehouse} placeholder={t.search} warehouses={warehouses} value={target} onChange={setTarget} />
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
