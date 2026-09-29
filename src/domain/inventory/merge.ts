import type { InventoryRow } from './read-model';
import type { RiskThresholdSettings, SkuAnalysis } from './types';

/** 예측에 실제로 쓴 소진 속도(수요일당). 추정할 수 없는 사유가 있으면 null. */
export function basisRate(a: SkuAnalysis): number | null {
  const op = a.operating;
  if (!op || op.reason !== null || !op.basisWindowDays) return null;
  const w = op.basisWindowDays === 7 ? a.window7 : op.basisWindowDays === 14 ? a.window14 : a.window30;
  return w.averageDailyDepletion;
}

/** 창고를 넘어 같은 품목으로 묶는 키 — 직접 묶은 키가 있으면 그것, 없으면 상품코드. */
export function mergeKeyOf(row: InventoryRow): string {
  return row.descriptor.mergeKey ?? row.descriptor.productCode;
}

export type MergedRisk = 'DANGER' | 'WARNING' | 'NORMAL' | 'UNKNOWN';

export interface MergedMember {
  skuId: string;
  warehouseId: string;
  warehouseName: string;
  productCode: string;
  stock: number;
  rate: number | null;
  value: number;
  isSoldOut: boolean;
}

export interface MergedRow {
  key: string;
  productName: string;
  productCodes: string[];
  members: MergedMember[];
  /** 품절 창고를 뺀 현재 재고 합계. */
  totalStock: number;
  totalValue: number;
  /** 추정 가능한 창고의 소진 속도 합(수요일당). 하나도 없으면 null. */
  totalRate: number | null;
  /** 속도를 모르는 창고가 있으면 true — 합계 속도가 실제보다 작을 수 있다. */
  partialRate: boolean;
  /** 합계 재고 ÷ 합계 속도(수요일). */
  coverageDays: number | null;
  risk: MergedRisk;
  allSoldOut: boolean;
}

/**
 * 여러 창고의 같은 품목을 한 줄로 합친다. 재고·금액·소진 속도는 더하고, 커버리지는 합계 재고 ÷ 합계 속도로 다시 계산한다
 * (창고끼리 재고를 옮겨 쓸 수 있다고 볼 때의 전체 여유). 위험 등급은 합친 커버리지를 워크스페이스 기준일수와 비교한다.
 */
export function mergeRowsAcrossWarehouses(rows: InventoryRow[], settings: Pick<RiskThresholdSettings, 'stockoutSoonDays' | 'manageMaxDays'>): MergedRow[] {
  const groups = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const key = mergeKeyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const merged: MergedRow[] = [];
  for (const [key, group] of groups) {
    const members: MergedMember[] = group.map((r) => ({
      skuId: r.descriptor.skuId,
      warehouseId: r.descriptor.warehouseId,
      warehouseName: r.descriptor.warehouseName,
      productCode: r.descriptor.productCode,
      stock: r.descriptor.isSoldOut ? 0 : Math.max(0, r.analysis.latest.normalStock),
      rate: r.descriptor.isSoldOut || r.descriptor.isB2B ? null : basisRate(r.analysis),
      value: r.descriptor.isSoldOut ? 0 : r.valueBreakdown.normalStockValue,
      isSoldOut: r.descriptor.isSoldOut,
    }));
    const live = members.filter((m) => !m.isSoldOut);
    const rates = live.map((m) => m.rate).filter((v): v is number => v !== null);
    const totalStock = live.reduce((s, m) => s + m.stock, 0);
    const totalRate = rates.length ? rates.reduce((s, v) => s + v, 0) : null;
    const coverageDays = totalRate && totalRate > 0 ? totalStock / totalRate : null;
    const risk: MergedRisk =
      coverageDays === null ? 'UNKNOWN' : coverageDays <= settings.stockoutSoonDays ? 'DANGER' : coverageDays <= settings.manageMaxDays ? 'WARNING' : 'NORMAL';
    const names = group.filter((r) => !r.descriptor.isSoldOut).map((r) => r.descriptor.productName);
    merged.push({
      key,
      productName: names[0] ?? group[0].descriptor.productName,
      productCodes: [...new Set(group.map((r) => r.descriptor.productCode))],
      members: members.sort((a, b) => a.warehouseName.localeCompare(b.warehouseName)),
      totalStock,
      totalValue: live.reduce((s, m) => s + m.value, 0),
      totalRate,
      partialRate: live.some((m) => m.rate === null) && rates.length > 0,
      coverageDays,
      risk: live.length === 0 ? 'UNKNOWN' : risk,
      allSoldOut: live.length === 0,
    });
  }
  const riskOrder: Record<MergedRisk, number> = { DANGER: 0, WARNING: 1, UNKNOWN: 2, NORMAL: 3 };
  return merged.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || (a.coverageDays ?? Infinity) - (b.coverageDays ?? Infinity) || a.key.localeCompare(b.key));
}
