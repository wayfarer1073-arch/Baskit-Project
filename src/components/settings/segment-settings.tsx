'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StoreItemLearning, SupplierRow } from '@/domain/segments/read-model';

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

function useRunner() {
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
  return { busy, run };
}

/** 숫자 하나를 고치고 저장하는 설정 카드 — 세그먼트 탭의 판단 기준에 쓴다. */
function NumberSettingCard({
  title,
  description,
  label,
  suffix,
  value,
  min,
  max,
  field,
  isAdmin,
  hint,
}: {
  title: string;
  description: string;
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  field: string;
  isAdmin: boolean;
  hint?: (v: number) => string;
}) {
  const [draft, setDraft] = useState(String(value));
  const { busy, run } = useRunner();
  const n = Number(draft);
  const valid = Number.isInteger(n) && n >= min && n <= max;
  const id = `setting-${field}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run(() => send('/api/settings', 'PATCH', { [field]: n }), '저장했어요.');
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <div className="flex items-center gap-2">
              <Input id={id} type="number" min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!isAdmin} className="w-24" />
              <span className="text-sm text-muted-foreground">{suffix}</span>
            </div>
          </div>
          {isAdmin && (
            <Button type="submit" size="sm" disabled={busy || !valid || n === value}>
              저장
            </Button>
          )}
        </form>
        {hint && valid && <p className="mt-2 text-xs text-muted-foreground">{hint(n)}</p>}
        {!valid && (
          <p className="mt-2 text-xs text-status-danger">
            {min}~{max} 사이 정수로 입력하세요.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── 비정기 실사 ─────────────────────────────────────────────────────────────────────────────

export function PeriodicSettings({ isAdmin, recountDays, stockoutSoonDays }: { isAdmin: boolean; recountDays: number; stockoutSoonDays: number }) {
  return (
    <div className="space-y-6">
      <NumberSettingCard
        title="실사 권장 주기"
        description="마지막 실사 후 이 기간이 지나면 '실사 권장'으로 표시해요. 오래 세지 않을수록 추정 오차가 커져요."
        label="마지막 실사 후"
        suffix="일이 지나면 다시 세기"
        value={recountDays}
        min={1}
        max={365}
        field="periodicRecountDays"
        isAdmin={isAdmin}
        hint={(v) => `예: ${v}일 전에 센 상품은 오늘부터 '실사 권장' 목록에 올라와요. 추정 신뢰도도 이 주기를 기준으로 매겨요.`}
      />
      <NumberSettingCard
        title="품절 임박 기준"
        description="추정 재고가 이 일수 안에 바닥날 것 같으면 '품절 임박'으로 표시해요. 일일 재고 연동의 같은 항목과 한 값을 공유해요."
        label="남은 재고가"
        suffix="일치 이하이면 품절 임박"
        value={stockoutSoonDays}
        min={1}
        max={365}
        field="stockoutSoonDays"
        isAdmin={isAdmin}
      />
    </div>
  );
}

// ── 매장 발주 예측 ──────────────────────────────────────────────────────────────────────────

const NO_SUPPLIER = 'none';

export function StoreSettings({
  isAdmin,
  checkRemainingPct,
  suppliers,
  items,
}: {
  isAdmin: boolean;
  checkRemainingPct: number;
  suppliers: SupplierRow[];
  items: StoreItemLearning[];
}) {
  return (
    <div className="space-y-6">
      <NumberSettingCard
        title="발주 확인 기준"
        description="발주 때 적은 충족 매출 중 남은 여유가 이 비율 이하가 되면 '발주 확인 필요'로 알려드려요. 리드타임 동안 팔릴 매출이 더 크면 그만큼 더 일찍 알려드려요."
        label="남은 매출 여유가"
        suffix="% 이하이면 발주 확인"
        value={checkRemainingPct}
        min={5}
        max={80}
        field="storeCheckRemainingPct"
        isAdmin={isAdmin}
        hint={(v) => `예: 충족 매출 300만 원이면, 발주 후 매출이 ${Math.round(300 * (1 - v / 100))}만 원을 넘을 때부터 확인 요청이 떠요.`}
      />
      <SupplierManagement suppliers={suppliers} />
      <StoreItemManagement items={items} suppliers={suppliers} />
    </div>
  );
}

function SupplierManagement({ suppliers }: { suppliers: SupplierRow[] }) {
  const { busy, run } = useRunner();
  const [drafts, setDrafts] = useState(Object.fromEntries(suppliers.map((s) => [s.id, { name: s.name, lead: String(s.leadTimeDays) }])));
  const [name, setName] = useState('');
  const [lead, setLead] = useState('1');

  return (
    <Card>
      <CardHeader>
        <CardTitle>발주처 · 리드타임</CardTitle>
        <CardDescription>
          리드타임 = 발주하고 받기까지 걸리는 일수. 같은 발주처에서 받는 품목은 한 번에 적용돼요. 리드타임 동안 팔릴 매출만큼 &apos;발주 확인&apos;을 앞당겨 알려드려요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {suppliers.length === 0 && <p className="text-sm text-muted-foreground">등록된 발주처가 없어요. 발주처 없이 품목마다 리드타임을 적어도 돼요.</p>}
        {suppliers.map((s) => {
          const d = drafts[s.id] ?? { name: s.name, lead: String(s.leadTimeDays) };
          const changed = d.name.trim() !== s.name || Number(d.lead) !== s.leadTimeDays;
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="발주처 이름"
                value={d.name}
                maxLength={50}
                onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...d, name: e.target.value } }))}
                className="w-44"
              />
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label={`${s.name} 리드타임(일)`}
                  type="number"
                  min={0}
                  max={60}
                  value={d.lead}
                  onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...d, lead: e.target.value } }))}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">일</span>
              </div>
              <span className="text-xs text-muted-foreground">품목 {s.itemCount}개</span>
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !changed}
                  onClick={() => run(() => send(`/api/store/suppliers/${s.id}`, 'PATCH', { name: d.name, leadTimeDays: Number(d.lead) }), '발주처를 저장했어요.')}
                >
                  저장
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`${s.name} 삭제`}
                  onClick={() =>
                    confirm(`'${s.name}' 발주처를 삭제할까요?${s.itemCount ? `\n연결된 품목 ${s.itemCount}개는 품목에 적어 둔 리드타임을 쓰게 돼요.` : ''}`) &&
                    run(() => send(`/api/store/suppliers/${s.id}`, 'DELETE'), '발주처를 삭제했어요.')
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
        <form
          className="flex flex-wrap items-center gap-2 border-t pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => send('/api/store/suppliers', 'POST', { name, leadTimeDays: Number(lead) }), `'${name}' 발주처를 추가했어요.`)) setName('');
          }}
        >
          <Input aria-label="새 발주처 이름" placeholder="새 발주처 (예: ○○유업)" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} className="w-44" />
          <div className="flex items-center gap-1.5">
            <Input aria-label="새 발주처 리드타임(일)" type="number" min={0} max={60} required value={lead} onChange={(e) => setLead(e.target.value)} className="w-20" />
            <span className="text-sm text-muted-foreground">일</span>
          </div>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            <Plus className="size-4" />
            발주처 추가
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface ItemDraft {
  name: string;
  unit: string;
  supplierId: string;
  lead: string;
}

function toDraft(i: StoreItemLearning): ItemDraft {
  return { name: i.name, unit: i.unit, supplierId: i.supplierId ?? NO_SUPPLIER, lead: String(i.itemLeadTimeDays) };
}

function payload(d: ItemDraft) {
  return { name: d.name, unit: d.unit, leadTimeDays: Number(d.lead), supplierId: d.supplierId === NO_SUPPLIER ? null : d.supplierId };
}

function ItemFields({ draft, onChange, suppliers, idPrefix }: { draft: ItemDraft; onChange: (d: ItemDraft) => void; suppliers: SupplierRow[]; idPrefix: string }) {
  const supplier = suppliers.find((s) => s.id === draft.supplierId);
  return (
    <>
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">
          품목 이름
        </Label>
        <Input id={`${idPrefix}-name`} required maxLength={50} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="예: 원두 1kg" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-unit`} className="text-xs">
          단위
        </Label>
        <Input id={`${idPrefix}-unit`} required maxLength={10} value={draft.unit} onChange={(e) => onChange({ ...draft, unit: e.target.value })} placeholder="봉, 팩, 박스" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-supplier`} className="text-xs">
          발주처
        </Label>
        <Select value={draft.supplierId} onValueChange={(v) => onChange({ ...draft, supplierId: v })}>
          <SelectTrigger id={`${idPrefix}-supplier`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SUPPLIER}>지정 안 함</SelectItem>
            {suppliers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-lead`} className="text-xs">
          리드타임
        </Label>
        {supplier ? (
          <p id={`${idPrefix}-lead`} className="flex h-9 items-center text-sm text-muted-foreground">
            발주처 기준 {supplier.leadTimeDays}일
          </p>
        ) : (
          <div className="flex items-center gap-1.5">
            <Input
              id={`${idPrefix}-lead`}
              type="number"
              min={0}
              max={60}
              required
              value={draft.lead}
              onChange={(e) => onChange({ ...draft, lead: e.target.value })}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">일</span>
          </div>
        )}
      </div>
    </>
  );
}

function StoreItemManagement({ items, suppliers }: { items: StoreItemLearning[]; suppliers: SupplierRow[] }) {
  const { busy, run } = useRunner();
  const [drafts, setDrafts] = useState(Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  const empty: ItemDraft = { name: '', unit: '개', supplierId: NO_SUPPLIER, lead: '1' };
  const [draft, setDraft] = useState(empty);
  const grid = 'grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_0.6fr_1fr_0.8fr_auto] sm:items-end';

  return (
    <Card>
      <CardHeader>
        <CardTitle>발주 품목</CardTitle>
        <CardDescription>원두·우유·컵처럼 발주하는 것들. 단위는 잔량을 셀 때 쓰는 단위예요(예: &quot;2봉 + 마지막 봉의 40%&quot;).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">아직 품목이 없어요. 아래에서 추가해 주세요.</p>}
        {items.map((i) => {
          const d = drafts[i.id] ?? toDraft(i);
          const original = toDraft(i);
          const changed = JSON.stringify(d) !== JSON.stringify(original);
          return (
            <div key={i.id} className={`${grid} rounded-lg border border-border p-3`}>
              <ItemFields draft={d} onChange={(next) => setDrafts((p) => ({ ...p, [i.id]: next }))} suppliers={suppliers} idPrefix={`item-${i.id}`} />
              <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !changed}
                  onClick={() => run(() => send(`/api/store/items/${i.id}`, 'PATCH', payload(d)), '품목을 저장했어요.')}
                >
                  저장
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`${i.name} 보관`}
                  title="품목 보관"
                  onClick={() =>
                    confirm(`'${i.name}' 품목을 보관할까요? 예측 목록에서 빠지고 기록은 남아요.`) && run(() => send(`/api/store/items/${i.id}`, 'DELETE'), '품목을 보관했어요.')
                  }
                >
                  <Archive className="size-4" />
                </Button>
              </div>
              <p className="col-span-2 text-[11px] text-muted-foreground sm:col-span-5">
                발주 {i.orderCount}회{i.learnedCycles > 0 ? ` · 학습 ${i.learnedCycles}회` : ' · 아직 학습 전'}
              </p>
            </div>
          );
        })}
        <form
          className={`${grid} border-t pt-3`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => send('/api/store/items', 'POST', payload(draft)), `'${draft.name}' 품목을 추가했어요.`)) setDraft(empty);
          }}
        >
          <ItemFields draft={draft} onChange={setDraft} suppliers={suppliers} idPrefix="new-item" />
          <Button type="submit" size="sm" disabled={busy || !draft.name.trim()} className="col-span-2 sm:col-span-1">
            <Plus className="size-4" />
            품목 추가
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
