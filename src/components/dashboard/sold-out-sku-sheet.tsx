'use client';

import { useState } from 'react';
import { PackageX } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { formatKstDate } from '@/lib/date';
import type { InventoryRow } from '@/domain/inventory/read-model';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

const PAGE_SIZE = 10;

interface SoldOutSkuSheetProps {
  rows: InventoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSku: (skuId: string) => void;
}

/** 품절 SKU 수 옆 상세보기 링크로 여는 목록 패널. 행을 클릭하면 이 패널을 닫고 해당 SKU의
 * 상세보기(SkuDetailSheet)를 연다 — 같은 우측 슬라이드 자리를 두 시트가 번갈아 쓴다. */
export function SoldOutSkuSheet({ rows, open, onOpenChange, onSelectSku }: SoldOutSkuSheetProps) {
  const { m } = useI18n();
  const t = m.dashboard.soldOut;
  const [page, setPage] = useState(1);
  // 패널을 다시 열 때마다 이전에 보던 페이지가 아니라 1페이지부터 보여준다 — 렌더 중 상태를
  // 조정하는 React 권장 패턴(useEffect 대신)으로, open이 실제로 바뀐 순간에만 한 번 실행된다.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{format(t.title, { count: rows.length })}</SheetTitle>
          <SheetDescription>
            {t.description}
          </SheetDescription>
        </SheetHeader>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <>
            <ul className="divide-y divide-border px-1 pb-2">
              {pageRows.map((r) => (
                <li key={r.descriptor.skuId}>
                  <button
                    type="button"
                    onClick={() => onSelectSku(r.descriptor.skuId)}
                    className="-mx-1 flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <PackageX className="size-3.5 shrink-0 text-status-soldout" aria-hidden="true" />
                      {r.descriptor.productName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.descriptor.productCode} · {r.descriptor.warehouseCode}
                      {r.descriptor.soldOutDetectedDate ? format(t.detected, { date: formatKstDate(r.descriptor.soldOutDetectedDate) }) : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pb-4 text-sm">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                  {m.dashboard.prev}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {currentPage} / {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
                  {m.dashboard.next}
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
