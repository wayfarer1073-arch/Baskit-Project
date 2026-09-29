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
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface WarehouseManagementProps {
  isAdmin: boolean;
  warehouses: { id: string; code: string; name: string }[];
}

export function WarehouseManagement({ isAdmin, warehouses }: WarehouseManagementProps) {
  const t = useI18n().m.settingsScreens;
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
      toast.success(t.warehouses.renamed);
      router.refresh();
    } catch {
      toast.error(t.common.saveFailed);
    } finally {
      setBusyId(null);
    }
  }

  async function archive(id: string, name: string) {
    if (!confirm(format(t.warehouses.archiveConfirm, { name }))) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/warehouses/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.warehouses.archiveFailed);
      toast.success(t.warehouses.archived);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.warehouses.archiveFailed);
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
      if (!res.ok) throw new Error(data.error ?? t.common.addFailed);
      toast.success(format(t.warehouses.added, { name: data.warehouse.name }));
      setNewName('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.common.addFailed);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t.warehouses.title}</CardTitle>
          <InfoTooltip className="text-brand-accent hover:text-brand-accent/80">
            {t.warehouses.description}
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
                  {t.common.save}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => archive(w.id, w.name)}
                  disabled={busyId === w.id || warehouses.length <= 1}
                  aria-label={format(t.warehouses.archiveAria, { name: w.name })}
                  title={warehouses.length <= 1 ? t.warehouses.needOne : t.warehouses.archive}
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
              placeholder={t.warehouses.newPlaceholder}
              maxLength={50}
              className="max-w-xs"
              aria-label={t.warehouses.newAria}
            />
            <Button type="submit" size="sm" disabled={adding || newName.trim() === ''}>
              <Plus className="size-4" />
              {t.warehouses.submit}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
