'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionPanel, SegmentDashboardHeader } from '@/components/segment-dashboards/dashboard-parts';
import type { OrderEntryRow, SalesEntryRow } from '@/domain/segments/read-model';
import { formatCurrency } from '@/lib/format';

interface ItemSummary {
  id: string;
  name: string;
  unit: string;
  leadTimeDays: number;
  orderCount: number;
}

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
      <SegmentDashboardHeader title="발주·매출 기록" description="발주할 때마다, 그리고 하루 매출을 남겨 두면 대시보드가 다음 발주일을 계산해요." />
      <div className="grid gap-6 lg:grid-cols-2">
        <OrderSection today={today} items={items} orders={orders} busy={busy} run={run} />
        <SalesSection today={today} sales={sales} busy={busy} run={run} />
      </div>
      <ItemSection items={items} busy={busy} run={run} />
    </div>
  );
}

type Run = (action: () => Promise<unknown>, success: string) => Promise<boolean>;

function OrderSection({ today, items, orders, busy, run }: { today: string; items: ItemSummary[]; orders: OrderEntryRow[]; busy: boolean; run: Run }) {
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState('');
  const unit = items.find((i) => i.id === itemId)?.unit ?? '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => send('/api/store/orders', 'POST', { itemId, date, quantity: Number(quantity) }), '발주를 기록했어요.');
    if (ok) setQuantity('');
  }

  return (
    <SectionPanel title="발주 기록" description="발주한 날짜와 수량을 남겨 주세요">
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">아래에서 발주 품목을 먼저 등록해 주세요.</p>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-b border-border px-5 py-4 sm:grid-cols-[1.4fr_1fr_0.8fr_auto] sm:items-end">
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="order-item">품목</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="order-item" className="w-full">
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
          <div className="space-y-1.5">
            <Label htmlFor="order-date">발주일</Label>
            <Input id="order-date" type="date" max={today} required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="order-qty">수량{unit && ` (${unit})`}</Label>
            <Input id="order-qty" type="number" inputMode="decimal" min="0.01" step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy || !itemId} className="col-span-2 sm:col-span-1">
            기록
          </Button>
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
    const ok = await run(() => send('/api/store/sales', 'PUT', { date, amount: Number(amount.replace(/,/g, '')) }), '매출을 저장했어요.');
    if (ok) setAmount('');
  }

  return (
    <SectionPanel title="일 매출" description="같은 날짜를 다시 저장하면 덮어써요 · 최근 3주">
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

function ItemSection({ items, busy, run }: { items: ItemSummary[]; busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('개');
  const [leadTimeDays, setLeadTimeDays] = useState('1');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => send('/api/store/items', 'POST', { name, unit, leadTimeDays: Number(leadTimeDays) }), `'${name}' 품목을 추가했어요.`);
    if (ok) setName('');
  }

  return (
    <SectionPanel title="발주 품목" description="리드타임 = 발주 후 도착까지 걸리는 일수. 권장 발주일을 그만큼 앞당겨요.">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-b border-border px-5 py-4 sm:grid-cols-[1.6fr_0.8fr_0.8fr_auto] sm:items-end">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="item-name">품목 이름</Label>
          <Input id="item-name" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 원두 (1kg)" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-unit">발주 단위</Label>
          <Input id="item-unit" required maxLength={10} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-lead">리드타임(일)</Label>
          <Input id="item-lead" type="number" min={0} max={60} required value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy} className="col-span-2 sm:col-span-1">
          품목 추가
        </Button>
      </form>
      <ul className="divide-y divide-border">
        {items.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">등록된 품목이 없어요.</li>}
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
            <span className="text-xs text-muted-foreground">
              단위 {i.unit} · 리드타임 {i.leadTimeDays}일 · 발주 {i.orderCount}회
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={busy}
              aria-label={`${i.name} 보관`}
              title="품목 보관"
              onClick={() => confirm(`'${i.name}' 품목을 보관할까요? 예측 목록에서 빠지고 기록은 남습니다.`) && run(() => send(`/api/store/items/${i.id}`, 'DELETE'), '품목을 보관했어요.')}
            >
              <Archive className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
}
