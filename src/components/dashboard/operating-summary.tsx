import { ShoppingCart, Building2 } from 'lucide-react';
import type { InventoryRow } from '@/domain/inventory/read-model';
import { formatCurrency } from '@/lib/format';
import { InfoTooltip } from '@/components/ui/info-tooltip';

export function OperatingSummary({ rows }: { rows: InventoryRow[] }) {
  const current = rows.filter(r => !r.descriptor.isSoldOut && r.analysis.operating?.staleShippingDays === 0);
  const b2b = current.filter(r => r.descriptor.isB2B);
  const regular = current.filter(r => !r.descriptor.isB2B);
  const value = (list: InventoryRow[]) => {
    const known = list.filter(r => r.analysis.latest.valuationKnown !== false && r.analysis.latest.normalStock >= 0);
    return known.length ? formatCurrency(known.reduce((sum, r) => sum + r.valueBreakdown.normalStockValue, 0)) : '평가 자료 없음';
  };
  return (
    <section aria-label="운영 유형별 재고">
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-base font-semibold">운영 유형별 판단</h2>
        <InfoTooltip>
          금액은 평가 가능한 관측 재고만 포함합니다. 커버리지는 관측일 재고 ÷ 출고일평균 추정 소진입니다.
          주말 제외, 등록 공휴일은 주문이 쌓이는 날로 보고 포함, 반품·조정 미분리. 자동 발주량·안전재고·마진·폐기 예상 수량은 산출하지 않습니다.
        </InfoTooltip>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground">
            <ShoppingCart className="size-[18px]" aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm text-sidebar-muted-foreground">일반 / B2C · {regular.length} SKU</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value(regular)}</p>
          <p className="mt-1 text-xs text-sidebar-muted-foreground">관측 자료가 충분한 SKU만 출고일 커버리지 제공</p>
        </div>
        <div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground">
            <Building2 className="size-[18px]" aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm text-sidebar-muted-foreground">B2B · {b2b.length} SKU</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value(b2b)}</p>
          <p className="mt-1 text-xs text-sidebar-muted-foreground">일괄 출고 예정 재고 · 발주/납품 일정과 소비기한 개별 확인</p>
        </div>
      </div>
    </section>
  );
}
