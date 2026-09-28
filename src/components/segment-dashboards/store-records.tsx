'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionPanel, SegmentDashboardHeader } from '@/components/segment-dashboards/dashboard-parts';
import { OPEN_UNIT_OPTIONS } from '@/components/segment-dashboards/coverage-parts';
import { describeUnits } from '@/domain/segments/sales-coverage';
import type { OrderEntryRow, SalesEntryRow, StoreItemLearning } from '@/domain/segments/read-model';
import { formatCurrency } from '@/lib/format';

type ItemSummary = StoreItemLearning;

interface StoreRecordsProps {
  today: string;
  items: ItemSummary[];
  orders: OrderEntryRow[];
  sales: SalesEntryRow[];
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? '요청에 실패했습니다.');
  return data;
}

export function StoreRecords({ today, items, orders, sales }: StoreRecordsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '요청에 실패했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SegmentDashboardHeader
        title="발주·매출 기록"
        description="발주할 때 '이 양으로 얼마어치 매출을 감당할지'를 함께 적고, 매일 매출만 입력하면 발주가 필요할 때 알려드려요."
        action={
          <Link href="/settings?tab=store" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            품목·발주처 설정
          </Link>
        }
      />
      <OrderSection today={today} items={items} orders={orders} busy={busy} run={run} />
      <SalesSection today={today} sales={sales} busy={busy} run={run} />
    </div>
  );
}

type Run = (action: () => Promise<unknown>, success: string) => Promise<boolean>;

interface DraftLine {
  key: number;
  itemId: string;
  quantity: string;
  coverage: string;
  /** 지금 남은 양 — 뜯지 않은 단위 수와, 열어 둔 마지막 단위가 남은 정도(%). 둘 다 비우면 '모름'. */
  leftWhole: string;
  leftOpen: string;
}

const won = (v: string) => Number(v.replace(/[^0-9]/g, ''));
let lineSeq = 0;
/** 첫 줄은 서버 렌더와 같은 key(0)를 쓰고, 이후 줄은 클라이언트에서만 번호를 늘린다(하이드레이션 불일치 방지). */
const newLine = (itemId: string, key = ++lineSeq): DraftLine => ({ key, itemId, quantity: '', coverage: '', leftWhole: '', leftOpen: '0' });

function leftoverOf(line: DraftLine): number | null {
  if (!line.leftWhole.trim() && line.leftOpen === '0') return null;
  return Math.max(0, Math.floor(Number(line.leftWhole) || 0)) + Number(line.leftOpen) / 100;
}

/** 앱이 예상한 잔량을 입력 칸 값으로 — 0.25 단위로 반올림. */
function leftoverDraft(units: number): Pick<DraftLine, 'leftWhole' | 'leftOpen'> {
  const q = Math.round(units * 4) / 4;
  const whole = Math.floor(q);
  return {
    leftWhole: String(whole),
    leftOpen: String(Math.round((q - whole) * 100)),
  };
}

function OrderSection({ today, items, orders, busy, run }: { today: string; items: ItemSummary[]; orders: OrderEntryRow[]; busy: boolean; run: Run }) {
  const [date, setDate] = useState(today);
  const [lines, setLines] = useState<DraftLine[]>([newLine(items[0]?.id ?? '', 0)]);
  const byId = new Map(items.map((i) => [i.id, i]));

  function update(key: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** 이 품목을 (잔량 + 이 수량)만큼 갖게 됐을 때 과거 기록상 감당했던 매출(학습값). */
  function suggestion(line: DraftLine) {
    const item = byId.get(line.itemId);
    const q = Number(line.quantity);
    if (!item || item.salesPerUnit === null || !(q > 0)) return null;
    const units = q + (leftoverOf(line) ?? 0);
    return {
      amount: Math.round((item.salesPerUnit * units) / 1000) * 1000,
      cycles: item.learnedCycles,
      withLeftover: units !== q,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = lines
      .filter((l) => l.itemId && Number(l.quantity) > 0)
      .map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        coverageAmount: l.coverage.trim() ? won(l.coverage) : null,
        leftoverQuantity: leftoverOf(l),
      }));
    const ok = await run(() => send('/api/store/orders', 'POST', { date, lines: payload }), `발주 ${payload.length}건을 기록했어요.`);
    if (ok) setLines([newLine(items[0]?.id ?? '')]);
  }

  return (
    <SectionPanel
      title="발주 기록"
      description="남은 양 = 발주하는 지금 남아 있는 양(모르면 비워 두세요). 충족 매출 = 남은 양과 이번 발주량으로 감당할 수 있다고 보는 매출액. 비워 두면 학습값으로 계산해요."
    >
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          발주 품목이 없어요.{' '}
          <Link href="/settings?tab=store" className="font-medium text-foreground underline underline-offset-4">
            설정 &gt; 매장 발주 예측
          </Link>
          에서 품목과 발주처를 먼저 등록해 주세요.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-date">발주일</Label>
              <Input id="order-date" type="date" max={today} required value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => {
              const item = byId.get(line.itemId);
              const hint = suggestion(line);
              return (
                <div key={line.key} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1.2fr_0.6fr_1.2fr_1fr_auto] sm:items-end">
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label htmlFor={`order-item-${line.key}`} className="text-xs">
                      품목 {index + 1}
                    </Label>
                    <Select
                      value={line.itemId}
                      onValueChange={(v) =>
                        update(line.key, {
                          itemId: v,
                          leftWhole: '',
                          leftOpen: '0',
                        })
                      }
                    >
                      <SelectTrigger id={`order-item-${line.key}`} className="w-full">
                        <SelectValue placeholder="품목 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`order-qty-${line.key}`} className="text-xs">
                      수량{item && ` (${item.unit})`}
                    </Label>
                    <Input
                      id={`order-qty-${line.key}`}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="any"
                      required
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: e.target.value })}
                    />
                  </div>
                  <fieldset className="col-span-2 space-y-1 sm:col-span-1">
                    <legend className="mb-1 text-xs font-medium">지금 남은 양</legend>
                    <div className="flex gap-1.5">
                      <Input
                        id={`order-left-${line.key}`}
                        aria-label={`뜯지 않은 ${item?.unit ?? '단위'} 수`}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        placeholder="모름"
                        value={line.leftWhole}
                        onChange={(e) => update(line.key, { leftWhole: e.target.value })}
                        className="w-20"
                      />
                      <span className="self-center text-xs text-muted-foreground">{item?.unit}</span>
                      <Select value={line.leftOpen} onValueChange={(v) => update(line.key, { leftOpen: v })}>
                        <SelectTrigger aria-label={`열어 둔 마지막 ${item?.unit ?? '단위'}에 남은 정도`} className="min-w-0 flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPEN_UNIT_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.value === '0' ? '+ 열린 것 없음' : `+ 마지막 ${item?.unit ?? ''} ${o.label}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </fieldset>
                  <div className="space-y-1">
                    <Label htmlFor={`order-cov-${line.key}`} className="text-xs">
                      충족 매출 (원)
                    </Label>
                    <Input
                      id={`order-cov-${line.key}`}
                      inputMode="numeric"
                      pattern="[0-9,]*"
                      placeholder={hint ? hint.amount.toLocaleString('ko-KR') : '예: 3,000,000'}
                      value={line.coverage}
                      onChange={(e) => update(line.key, { coverage: e.target.value })}
                      required={!hint}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 justify-self-end"
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    aria-label={`품목 ${index + 1} 줄 삭제`}
                  >
                    <X className="size-4" />
                  </Button>
                  <div className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-5">
                    {item && item.estimatedRemainingUnits !== null && (
                      <p>
                        앱 예상 잔량:{' '}
                        <strong className="text-foreground">
                          {item.estimatedRemainingUnits <= 0.05 ? '거의 없음' : describeUnits(Math.round(item.estimatedRemainingUnits * 4) / 4, item.unit)}
                        </strong>{' '}
                        <button type="button" className="underline underline-offset-2" onClick={() => update(line.key, leftoverDraft(item.estimatedRemainingUnits ?? 0))}>
                          이 값 쓰기
                        </button>
                        <span className="ml-1">· 실제로 세어 적어 주면 다음 예측이 정확해져요</span>
                      </p>
                    )}
                    <p>
                      {hint ? (
                        <>
                          학습값: {hint.withLeftover ? '남은 양까지 합치면' : '이 수량이면'} 과거 기록상 약{' '}
                          <strong className="text-foreground">{hint.amount.toLocaleString('ko-KR')}원</strong>
                          어치 매출을 감당했어요 (발주 {hint.cycles}회 학습).{' '}
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() =>
                              update(line.key, {
                                coverage: hint.amount.toLocaleString('ko-KR'),
                              })
                            }
                          >
                            이 값 쓰기
                          </button>
                        </>
                      ) : item && item.orderCount > 0 ? (
                        '아직 학습 전이에요. 이번 발주로 감당할 매출을 적어 주세요 — 다음 발주부터 실제 값과 비교해 학습해요.'
                      ) : (
                        '첫 발주예요. 이 양으로 얼마어치 매출을 감당할지 어림잡아 적어 주세요.'
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine(items[0]?.id ?? '')])}>
              <Plus className="size-3.5" />
              품목 추가
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              발주 기록
            </Button>
          </div>
        </form>
      )}
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {orders.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">아직 발주 기록이 없어요.</li>}
        {orders.map((o) => (
          <li key={o.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{o.date}</span>
            <span className="min-w-0 flex-1 truncate">{o.itemName}</span>
            <span className="tabular-nums">
              {o.quantity.toLocaleString('ko-KR')}
              {o.unit}
            </span>
            <span className="hidden w-40 text-right text-xs text-muted-foreground sm:inline">
              {o.coverageAmount === null ? '충족 매출 학습값' : `충족 ${formatCurrency(o.coverageAmount)}`}
              {o.leftoverQuantity !== null && <span className="block">당시 잔량 {o.leftoverQuantity <= 0 ? '없음' : describeUnits(o.leftoverQuantity, o.unit)}</span>}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={busy}
              aria-label={`${o.date} ${o.itemName} 발주 기록 삭제`}
              onClick={() => confirm('이 발주 기록을 삭제할까요?') && run(() => send(`/api/store/orders/${o.id}`, 'DELETE'), '삭제했어요.')}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
}

function SalesSection({ today, sales, busy, run }: { today: string; sales: SalesEntryRow[]; busy: boolean; run: Run }) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      () =>
        send('/api/store/sales', 'PUT', {
          date,
          amount: Number(amount.replace(/,/g, '')),
        }),
      '매출을 저장했어요.',
    );
    if (ok) setAmount('');
  }

  return (
    <SectionPanel title="일 매출" description="매일 한 번, 그날 매출 합계만 적으면 돼요 · 같은 날짜를 다시 저장하면 덮어써요 · 최근 3주">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-b border-border px-5 py-4 sm:grid-cols-[1fr_1.2fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="sales-date">날짜</Label>
          <Input id="sales-date" type="date" max={today} required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sales-amount">매출 (원)</Label>
          <Input id="sales-amount" inputMode="numeric" required pattern="[0-9,]+" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,250,000" />
        </div>
        <Button type="submit" disabled={busy} className="col-span-2 sm:col-span-1">
          저장
        </Button>
      </form>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {sales.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">최근 매출 기록이 없어요.</li>}
        {sales.map((s) => (
          <li key={s.date} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{s.date}</span>
            <span className="flex-1 text-right tabular-nums">{formatCurrency(s.amount)}</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={busy}
              aria-label={`${s.date} 매출 삭제`}
              onClick={() => confirm(`${s.date} 매출 기록을 삭제할까요?`) && run(() => send(`/api/store/sales?date=${s.date}`, 'DELETE'), '삭제했어요.')}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
}
