import { attachIntervalInbounds } from '@/domain/inventory/inbounds';
import { NO_HOLIDAYS, type ClosedDays } from '@/domain/inventory/shipping-calendar';
import type { StockObservation } from '@/domain/inventory/types';

/**
 * 재고 원장 — 모든 입력 방식(3PL 스냅샷, 직접 실사, 입고 기록, 이후의 주문 차감·조정)이 공유하는 한 가지 형태.
 *
 * - 수준(level) 행: SNAPSHOT(외부 재고현황 파일), COUNT(사람이 직접 센 실사). 그날 마감 기준 재고 수량이다.
 * - 변화(movement) 행: INBOUND(+ 입고), ORDER(− 주문 차감), ADJUST(± 조정). 두 수준 행 사이의 변화를 설명한다.
 *
 * 분석 엔진은 원장을 관측치(수준 행 + 구간 입고)로 바꿔 쓴다. 지금은 스냅샷·실사·입고만 쓰고, 주문 차감과
 * 조정은 주문 보강·자체출고 추정 모드에서 역산에 쓴다.
 */
export type LedgerSource = 'SNAPSHOT' | 'COUNT' | 'INBOUND' | 'ORDER' | 'ADJUST';

export const LEVEL_SOURCES: readonly LedgerSource[] = ['SNAPSHOT', 'COUNT'];

/** 수준 행에 함께 저장되는 평가·기준 정보(원가, 불량·입고대기, 경고·위험수량). */
export interface LevelValuation {
  unitCost: number;
  totalCost?: number;
  valuationKnown?: boolean;
  defectiveStock: number;
  incomingStock: number;
  warningQty: number;
  dangerQty: number;
}

export interface LedgerEntry {
  date: string; // yyyy-MM-dd
  locationId: string;
  itemId: string;
  source: LedgerSource;
  /** 수준 행이면 재고 수량, 변화 행이면 부호 있는 변화량. */
  quantity: number;
  valuation?: LevelValuation;
  /** 근거 기록 id(스냅샷 행, 입고 기록 등). */
  ref?: string;
}

export function isLevelEntry(entry: LedgerEntry): boolean {
  return LEVEL_SOURCES.includes(entry.source);
}

const EMPTY_VALUATION: LevelValuation = { unitCost: 0, defectiveStock: 0, incomingStock: 0, warningQty: 0, dangerQty: 0 };

/**
 * 품목 하나의 원장을 분석 엔진이 쓰는 관측치 목록으로 바꾼다.
 * 같은 날짜에 스냅샷과 실사가 함께 있으면 사람이 직접 센 실사를 우선한다.
 */
export function observationsFromLedger(entries: LedgerEntry[], calendar: ClosedDays = NO_HOLIDAYS): StockObservation[] {
  const levelsByDate = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    if (!isLevelEntry(entry)) continue;
    const existing = levelsByDate.get(entry.date);
    if (!existing || (existing.source === 'SNAPSHOT' && entry.source === 'COUNT')) levelsByDate.set(entry.date, entry);
  }
  const levels = [...levelsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const observations: StockObservation[] = levels.map((level) => {
    const v = level.valuation ?? EMPTY_VALUATION;
    return {
      date: level.date,
      source: level.source === 'COUNT' ? 'COUNT' : 'SNAPSHOT',
      availableStock: level.quantity,
      normalStock: level.quantity,
      defectiveStock: v.defectiveStock,
      incomingStock: v.incomingStock,
      unitCost: v.unitCost,
      totalCost: v.totalCost,
      valuationKnown: v.valuationKnown,
      warningQty: v.warningQty,
      dangerQty: v.dangerQty,
    };
  });
  const inbounds = entries.filter((e) => e.source === 'INBOUND').map((e) => ({ date: e.date, quantity: e.quantity }));
  return attachIntervalInbounds(observations, inbounds, calendar);
}

export interface LedgerFreshness {
  lastLevelDate: string | null;
  lastLevelSource: LedgerSource | null;
  /** 마지막으로 사람이 직접 센 날(실사). 한 번도 없으면 null. */
  lastCountDate: string | null;
}

/** 신뢰도 계산용 — 마지막 수준 행과 마지막 실사가 언제·어떤 출처였는지. */
export function ledgerFreshness(entries: LedgerEntry[], asOfDate: string): LedgerFreshness {
  let lastLevel: LedgerEntry | null = null;
  let lastCountDate: string | null = null;
  for (const e of entries) {
    if (!isLevelEntry(e) || e.date > asOfDate) continue;
    if (!lastLevel || e.date > lastLevel.date || (e.date === lastLevel.date && e.source === 'COUNT')) lastLevel = e;
    if (e.source === 'COUNT' && (!lastCountDate || e.date > lastCountDate)) lastCountDate = e.date;
  }
  return { lastLevelDate: lastLevel?.date ?? null, lastLevelSource: lastLevel?.source ?? null, lastCountDate };
}

/** 여러 품목이 섞인 원장을 품목별로 나눈다. */
export function groupByItem(entries: LedgerEntry[]): Map<string, LedgerEntry[]> {
  const map = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const list = map.get(e.itemId);
    if (list) list.push(e);
    else map.set(e.itemId, [e]);
  }
  return map;
}
