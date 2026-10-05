/**
 * 로스 리포트 — 두 번 센 재고(Easy Count) 사이에 실제로 쓴 양과 레시피로 계산한 이론 소모량을 비교한다.
 *
 * 실제 사용 = 앞 실사 + 그 사이 발주 − 뒤 실사. 레시피 기준 = 그 사이 메뉴 판매 × 레시피.
 * 차이(실제 − 레시피)가 +면 레시피보다 더 쓴 것(폐기·시음·과다 사용·빠진 판매 기록),
 * −면 덜 쓴 것(레시피 양이 많거나 발주 기록이 빠졌거나 센 값이 틀렸을 수 있음)이다.
 * 구간은 recipe-usage의 예상 재고와 같다 — 앞 실사일 다음 날부터 뒤 실사일까지(센 날의 발주·소모는 그 실사에 들어 있다고 본다).
 */
import { daysBetween } from '@/domain/inventory/shipping-calendar';

/** 차이 비율(|차이| ÷ 레시피 기준)로 나누는 단계 — 5% 이내 정상, 15% 이내 주의, 그 위는 확인 필요. */
export const LOSS_LIMITS = { ok: 0.05, watch: 0.15 } as const;
/** 개봉 잔량은 눈대중(25·50·75%)이라 이만큼의 차이는 비율과 상관없이 정상으로 본다(품목 단위). */
export const LOSS_TOLERANCE_UNITS = 0.1;

export type LossLevel = 'ok' | 'watch' | 'check' | 'no_sales';

export interface CountPoint {
  date: string;
  fullUnits: number;
  openedPercent: number | null;
}

export interface CountIntervalLoss {
  from: string;
  to: string;
  /** 구간 날 수(앞 실사 다음 날 ~ 뒤 실사일). */
  days: number;
  /** 구간 중 메뉴 판매 기록이 있는 날 수 — 날 수보다 적으면 빠진 판매 때문에 레시피 기준이 작게 나올 수 있다. */
  salesDays: number;
  startUnits: number;
  orderedUnits: number;
  endUnits: number;
  /** 실제 사용 = 앞 실사 + 발주 − 뒤 실사. */
  actualUsed: number;
  /** 레시피 기준 이론 소모량. */
  theoretical: number;
  /** 실제 − 레시피. */
  difference: number;
  /** 차이 ÷ 레시피 기준(레시피 기준이 0이면 null). */
  rate: number | null;
  level: LossLevel;
}

export const countUnits = (c: Pick<CountPoint, 'fullUnits' | 'openedPercent'>) => c.fullUnits + (c.openedPercent ?? 0) / 100;

export function lossLevel(difference: number, theoretical: number, salesDays: number): LossLevel {
  if (Math.abs(difference) <= LOSS_TOLERANCE_UNITS) return 'ok';
  if (theoretical <= 0) return salesDays === 0 ? 'no_sales' : 'check';
  const rate = Math.abs(difference) / theoretical;
  if (rate <= LOSS_LIMITS.ok) return 'ok';
  return rate <= LOSS_LIMITS.watch ? 'watch' : 'check';
}

/** 앞뒤 두 실사 사이의 실제 사용량과 레시피 기준 소모량을 비교한다. */
export function countIntervalLoss(
  start: CountPoint,
  end: CountPoint,
  orders: { date: string; quantity: number }[],
  usageByDate: Map<string, number> | undefined,
  salesDates: Iterable<string>,
): CountIntervalLoss {
  const inside = (date: string) => date > start.date && date <= end.date;
  const startUnits = countUnits(start);
  const endUnits = countUnits(end);
  const orderedUnits = orders.filter((o) => inside(o.date)).reduce((s, o) => s + o.quantity, 0);
  let theoretical = 0;
  for (const [date, units] of usageByDate ?? []) if (inside(date)) theoretical += units;
  let salesDays = 0;
  for (const date of new Set(salesDates)) if (inside(date)) salesDays++;
  const actualUsed = startUnits + orderedUnits - endUnits;
  const difference = actualUsed - theoretical;
  return {
    from: start.date,
    to: end.date,
    days: daysBetween(start.date, end.date),
    salesDays,
    startUnits,
    orderedUnits,
    endUnits,
    actualUsed,
    theoretical,
    difference,
    rate: theoretical > 0 ? difference / theoretical : null,
    level: lossLevel(difference, theoretical, salesDays),
  };
}

const SEVERITY: Record<LossLevel, number> = { check: 0, watch: 1, no_sales: 2, ok: 3 };

/** 확인 필요 → 주의 → 판매 없음 → 정상, 같은 단계에서는 차이 금액(없으면 비율)이 큰 순. */
export function compareLoss(a: { loss: CountIntervalLoss; unitCost: number | null }, b: { loss: CountIntervalLoss; unitCost: number | null }): number {
  const weight = (x: typeof a) => Math.abs(x.loss.difference) * (x.unitCost ?? 0) || Math.abs(x.loss.rate ?? 0);
  return SEVERITY[a.loss.level] - SEVERITY[b.loss.level] || weight(b) - weight(a);
}
