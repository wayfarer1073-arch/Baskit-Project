'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WarehouseDayPanel } from '@/components/upload/warehouse-day-panel';
import { formatKstDate } from '@/lib/date';
import type { CalendarEntry } from '@/components/upload/upload-calendar';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface DayDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  warehouses: { id: string; code: string; name: string }[];
  entryByWarehouseId: Map<string, CalendarEntry>;
  blocked: boolean;
  isAdmin: boolean;
}

export function DayDetailDialog({ open, onOpenChange, date, warehouses, entryByWarehouseId, blocked, isAdmin }: DayDetailDialogProps) {
  const [activeWarehouseId, setActiveWarehouseId] = useState(warehouses[0]?.id ?? '');
  const { m } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{format(m.upload.dayTitle, { date: formatKstDate(date) })}</DialogTitle>
          <DialogDescription>{blocked ? m.upload.dayBlocked : m.upload.dayIntro}</DialogDescription>
        </DialogHeader>

        {warehouses.length === 0 && (
          <p className="rounded-md bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
            {m.upload.noWarehouse}{' '}
            <Link href="/settings?tab=common" className="font-medium text-foreground underline underline-offset-4">
              {m.nav.items.settings}
            </Link>
          </p>
        )}
        <Tabs value={activeWarehouseId} onValueChange={setActiveWarehouseId}>
          <TabsList>
            {warehouses.map((w) => (
              <TabsTrigger key={w.id} value={w.id} className="gap-1">
                {w.name}
                {entryByWarehouseId.has(w.id) && <CheckCircle2 className="size-3.5 text-status-normal" aria-label={m.upload.uploadedMark} />}
              </TabsTrigger>
            ))}
          </TabsList>
          {warehouses.map((w) => (
            <TabsContent key={w.id} value={w.id}>
              <WarehouseDayPanel
                warehouseId={w.id}
                warehouseName={w.name}
                date={date}
                existing={
                  entryByWarehouseId.get(w.id)
                    ? {
                        uploadedByName: entryByWarehouseId.get(w.id)!.uploadedByName,
                        uploadedAt: entryByWarehouseId.get(w.id)!.uploadedAt,
                        rowCount: entryByWarehouseId.get(w.id)!.rowCount,
                      }
                    : null
                }
                blocked={blocked}
                isAdmin={isAdmin}
              />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
