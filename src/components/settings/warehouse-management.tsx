'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/info-tooltip';

interface WarehouseManagementProps {
  isAdmin: boolean;
  warehouses: { id: string; code: string; name: string }[];
}

export function WarehouseManagement({ isAdmin, warehouses }: WarehouseManagementProps) {
  const router = useRouter();
  const [names, setNames] = useState(Object.fromEntries(warehouses.map((w) => [w.id, w.name])));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  async function rename(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/warehouses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: names[id] }),
      });
      if (!res.ok) throw new Error();
      toast.success('창고명이 저장되었습니다.');
      router.refresh();
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function archive(id: string, name: string) {
    if (!confirm(`'${name}' 창고를 보관할까요?\n대시보드와 업로드 목록에서 빠지며, 지금까지의 기록은 그대로 보존됩니다.`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/warehouses/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? '보관에 실패했습니다.');
      toast.success('창고를 보관했습니다.');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '보관에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? '추가에 실패했습니다.');
      toast.success(`'${data.warehouse.name}' 창고를 추가했습니다.`);
      setNewName('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>창고 관리</CardTitle>
          <InfoTooltip className="text-brand-accent hover:text-brand-accent/80">
            창고마다 서로 다른 상품을 관리하는 별도의 공간이라, 이름을 바꾸거나 창고를 추가해도 재고가 서로 합쳐지지 않아요. 보관한 창고는 화면에서만 빠지고 기록은 남습니다.
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {warehouses.map((w) => (
          <div key={w.id} className="flex items-center gap-2">
            <Label htmlFor={`warehouse-name-${w.id}`} className="w-10 shrink-0 rounded bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-muted-foreground">
              {w.code}
            </Label>
            <Input
              id={`warehouse-name-${w.id}`}
              value={names[w.id] ?? ''}
              onChange={(e) => setNames((prev) => ({ ...prev, [w.id]: e.target.value }))}
              disabled={!isAdmin}
              className="max-w-xs"
            />
            {isAdmin && (
              <>
                <Button size="sm" variant="outline" onClick={() => rename(w.id)} disabled={busyId === w.id}>
                  저장
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => archive(w.id, w.name)}
                  disabled={busyId === w.id || warehouses.length <= 1}
                  aria-label={`${w.name} 보관`}
                  title={warehouses.length <= 1 ? '창고가 최소 하나는 있어야 합니다' : '창고 보관'}
                >
                  <Archive className="size-4" />
                </Button>
              </>
            )}
          </div>
        ))}
        {isAdmin && (
          <form onSubmit={add} className="flex items-center gap-2 border-t pt-3">
            <span className="w-10 shrink-0" aria-hidden="true" />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="새 창고 이름 (예: 성수 물류센터)"
              maxLength={50}
              className="max-w-xs"
              aria-label="새 창고 이름"
            />
            <Button type="submit" size="sm" disabled={adding || newName.trim() === ''}>
              <Plus className="size-4" />
              창고 추가
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
