'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Download, UploadCloud } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatKstDateTime } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Paged } from '@/components/ui/paged';

interface PackagingUploadStatus {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  lastUpload: { uploadedAt: string; uploadedByName: string; sourceFileName: string; rowCount: number } | null;
}

interface SkuPackagingManagementProps {
  isAdmin: boolean;
  warehouses: { id: string; code: string; name: string }[];
  initialStatuses: PackagingUploadStatus[];
}

export function SkuPackagingManagement({ isAdmin, warehouses, initialStatuses }: SkuPackagingManagementProps) {
  const t = useI18n().m.settingsScreens;
  const [statuses, setStatuses] = useState(initialStatuses);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function refreshStatuses() {
    const res = await fetch('/api/packaging');
    if (res.ok) {
      const body = await res.json();
      setStatuses(body.statuses ?? []);
    }
  }

  async function handleUpload() {
    if (!warehouseId || !file) {
      toast.error(t.common.pickWarehouseAndFile);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('warehouseId', warehouseId);
      formData.append('file', file);
      const res = await fetch('/api/packaging', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? body.issues?.[0]?.message ?? t.common.uploadFailed);
        return;
      }
      const unmatchedText = body.unmatchedProductCodes.length > 0 ? format(t.common.unmatchedCodes, { count: body.unmatchedProductCodes.length }) : '';
      toast.success(format(t.common.uploadResult, { count: body.updatedCount }) + unmatchedText);
      await refreshStatuses();
      setFile(null);
    } catch {
      toast.error(t.common.uploadNetworkFailed);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t.packaging.title}</CardTitle>
          <InfoTooltip tone="header">
            {t.packaging.description}
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="packaging-warehouse">{t.common.warehouse}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger id="packaging-warehouse" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="packaging-file">{t.packaging.file}</Label>
              <Input id="packaging-file" type="file" accept=".xls,.xlsx,.csv,.tsv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
            </div>
            <Button onClick={handleUpload} disabled={uploading || !file}>
              <UploadCloud className="size-4" />
              {uploading ? t.common.uploading : t.common.upload}
            </Button>
            <Button variant="outline" size="sm" className="text-foreground hover:text-brand-accent" asChild>
              <a href="/api/templates/packaging">
                <Download className="size-3.5" />
                {t.common.sample}
              </a>
            </Button>
          </div>
        )}

        <Paged items={statuses} pagerClassName="mt-2">
          {(pageItems) => (
            <div className="space-y-1.5">
              {pageItems.map((s) => (
                <div key={s.warehouseId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{s.warehouseCode}</span>
                    <span className="font-medium">{s.warehouseName}</span>
                  </div>
                  {s.lastUpload ? (
                    <span className="text-xs text-muted-foreground">
                      {format(t.packaging.lastUpdate, { date: formatKstDateTime(s.lastUpload.uploadedAt), user: s.lastUpload.uploadedByName, file: s.lastUpload.sourceFileName, count: s.lastUpload.rowCount })}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t.packaging.noHistory}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Paged>
      </CardContent>
    </Card>
  );
}
