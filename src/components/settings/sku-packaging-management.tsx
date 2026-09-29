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
      toast.error('창고와 Excel 파일을 선택하세요.');
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
        toast.error(body.error ?? body.issues?.[0]?.message ?? '업로드에 실패했습니다.');
        return;
      }
      const unmatchedText = body.unmatchedProductCodes.length > 0 ? ` · 인식되지 않은 상품코드 ${body.unmatchedProductCodes.length}건` : '';
      toast.success(`${body.updatedCount}건 반영${unmatchedText}`);
      await refreshStatuses();
      setFile(null);
    } catch {
      toast.error('네트워크 오류로 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>SKU 추가 정보 관리</CardTitle>
          <InfoTooltip className="text-brand-accent hover:text-brand-accent/80">
            SKU별 EA/BOX·EA/PLT·상품바코드를 관리합니다.
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="packaging-warehouse">창고</Label>
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
              <Label htmlFor="packaging-file">SKU 추가 정보 Excel (.xls, .xlsx)</Label>
              <Input id="packaging-file" type="file" accept=".xls,.xlsx,.csv,.tsv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
            </div>
            <Button onClick={handleUpload} disabled={uploading || !file}>
              <UploadCloud className="size-4" />
              {uploading ? '업로드 중...' : '업로드'}
            </Button>
            <Button variant="outline" size="sm" className="text-foreground hover:text-brand-accent" asChild>
              <a href="/api/templates/packaging">
                <Download className="size-3.5" />
                샘플파일 다운로드
              </a>
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          {statuses.map((s) => (
            <div key={s.warehouseId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{s.warehouseCode}</span>
                <span className="font-medium">{s.warehouseName}</span>
              </div>
              {s.lastUpload ? (
                <span className="text-xs text-muted-foreground">
                  마지막 업데이트 {formatKstDateTime(s.lastUpload.uploadedAt)} · {s.lastUpload.uploadedByName} · {s.lastUpload.sourceFileName} ({s.lastUpload.rowCount}건)
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">업데이트 이력 없음</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
