'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, Info, RotateCcw, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InboundManager } from '@/components/upload/inbound-manager';
import { LayoutReview, type LayoutPreview } from '@/components/upload/layout-review';
import type { ImportLayout } from '@/domain/excel/layout-types';
import { formatKstDate, formatKstDateTime } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';
import { MAX_UPLOAD_DATA_ROWS } from '@/lib/upload-limits';
import { format } from '@/lib/i18n/locales';

interface ValidationIssue {
  level: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

interface WarehouseDayPanelProps {
  warehouseId: string;
  warehouseName: string;
  date: string;
  existing: { uploadedByName: string; uploadedAt: string; rowCount: number; snapshotId?: string; sourceFile?: { fileName: string; size: number } | null } | null;
  blocked: boolean;
  isAdmin: boolean;
  /** 미리보기에서 이 파일로 품절 처리될 기존 SKU를 함께 받는다(비정기 실사). */
  checkMissing?: boolean;
  /** 입고 특이사항을 이 패널 아래에 함께 보여줄지(비정기 실사는 별도 '입고 기록' 탭에서 받는다). */
  showInbound?: boolean;
}

/** 하루·한 창고 분량의 업로드 폼 + 입고 특이사항. 날짜 패널(DayDetailDialog)의 탭 하나의 내용이다. */
export function WarehouseDayPanel({ warehouseId, warehouseName, date, existing, blocked, isAdmin, checkMissing, showInbound = true }: WarehouseDayPanelProps) {
  const router = useRouter();
  const { m } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [preview, setPreview] = useState<LayoutPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saveTemplate, setSaveTemplate] = useState(true);
  const [templateName, setTemplateName] = useState(() => format(m.layout.templateNameDefault, { warehouse: warehouseName }));
  const previewSeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 파일(과 사용자가 고친 양식)을 서버 파서로 미리 읽는다. 늦게 온 이전 응답은 버린다. */
  async function loadPreview(target: File, layout?: ImportLayout) {
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const formData = new FormData();
    formData.append('file', target);
    formData.append('warehouseId', warehouseId);
    if (checkMissing) formData.append('date', date);
    if (layout) formData.append('layout', JSON.stringify(layout));
    try {
      const res = await fetch('/api/upload/preview', { method: 'POST', body: formData });
      const body = await res.json().catch(() => ({}));
      if (seq !== previewSeq.current) return;
      if (!res.ok) {
        setPreview(null);
        toast.error(body.error ?? m.upload.failed);
        return;
      }
      setPreview(body);
    } catch {
      if (seq === previewSeq.current) toast.error(m.common.networkError);
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }

  function chooseFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setIssues([]);
    setDuplicate(false);
    if (next) loadPreview(next);
  }

  async function resetUpload() {
    if (!confirm(format(m.upload.resetConfirm, { warehouse: warehouseName, date: formatKstDate(date) }))) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/upload?warehouseId=${encodeURIComponent(warehouseId)}&snapshotDate=${encodeURIComponent(date)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? m.upload.resetFailed);
        return;
      }
      toast.success(m.upload.resetDone);
      router.refresh();
    } catch {
      toast.error(m.common.networkError);
    } finally {
      setResetting(false);
    }
  }

  async function submit() {
    if (!file) {
      toast.error(m.upload.chooseFile);
      return;
    }

    setUploading(true);
    setIssues([]);
    setDuplicate(false);
    const formData = new FormData();
    formData.append('warehouseId', warehouseId);
    formData.append('snapshotDate', date);
    formData.append('replaceExisting', String(!!existing));
    formData.append('file', file);
    if (preview) formData.append('layout', JSON.stringify(preview.layout));
    if (preview && !preview.template && saveTemplate && templateName.trim()) formData.append('templateName', templateName.trim());

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      let body = await res.json();
      let status = res.status;

      // 큰 파일은 뒤에서 처리된다 — 끝날 때까지 작업 상태를 확인한다.
      if (status === 202 && body.jobId) {
        toast.info(m.upload.processingLarge);
        const job = await waitForUploadJob(body.jobId);
        if (job.status === 'FAILED' || !job.result) {
          toast.error(job.error ?? m.upload.failed);
          return;
        }
        body = job.result;
        status = body.status === 'ERROR' ? 422 : body.status === 'CONFLICT' ? 409 : 200;
      }

      if (status === 409) {
        toast.error(m.upload.conflict);
        return;
      }
      if (status === 422) {
        setIssues(body.issues ?? []);
        return;
      }
      if (status >= 400) {
        toast.error(body.error ?? m.upload.failed);
        return;
      }
      if (body.status === 'DUPLICATE') {
        setDuplicate(true);
        return;
      }

      toast.success(format(m.upload.saved, { warehouse: warehouseName, count: body.rowCount.toLocaleString() }));
      if (body.newCodes?.length) toast.info(format(m.codeAliases.newCodesToast, { count: body.newCodes.length }), { duration: 8000 });
      setFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      router.refresh();
    } catch {
      toast.error(m.common.networkError);
    } finally {
      setUploading(false);
    }
  }

  const errorIssues = issues.filter((i) => i.level === 'ERROR');

  return (
    <div className="space-y-3">
      {existing && !blocked && (
        <div role="alert" className="flex items-start gap-1.5 rounded-md border border-status-warning/30 bg-status-warning-bg p-2.5 text-xs text-status-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {format(m.upload.existingReplace, { name: existing.uploadedByName, time: formatKstDateTime(existing.uploadedAt), count: existing.rowCount.toLocaleString() })}
          </span>
        </div>
      )}

      {existing && blocked && (
        <p className="text-xs text-muted-foreground">
          {format(m.upload.existingInfo, { name: existing.uploadedByName, time: formatKstDateTime(existing.uploadedAt), count: existing.rowCount.toLocaleString() })}
        </p>
      )}

      {existing?.snapshotId && existing.sourceFile && (
        <a
          href={`/api/upload/files/${existing.snapshotId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline"
          download={existing.sourceFile.fileName}
        >
          <Download className="size-3.5" aria-hidden="true" />
          {format(m.upload.downloadOriginal, { name: existing.sourceFile.fileName, size: formatFileSize(existing.sourceFile.size) })}
        </a>
      )}

      {blocked && !existing && <p className="text-xs text-muted-foreground">{m.upload.blockedHoliday}</p>}

      {!blocked && (
        <div className="space-y-1.5">
          <Label htmlFor={`warehouse-day-file-${warehouseId}`}>{m.upload.fileLabel}</Label>
          <Input ref={fileInputRef} id={`warehouse-day-file-${warehouseId}`} type="file" accept=".xls,.xlsx,.csv,.tsv,.txt" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted-foreground">{format(m.upload.rowLimit, { rows: MAX_UPLOAD_DATA_ROWS })}</p>
          {file && (
            <LayoutReview
              preview={preview}
              loading={previewing}
              date={date}
              onLayoutChange={(layout) => loadPreview(file, layout)}
              saveTemplate={saveTemplate}
              onSaveTemplateChange={setSaveTemplate}
              templateName={templateName}
              onTemplateNameChange={setTemplateName}
            />
          )}
          <p className="text-xs text-muted-foreground">{m.upload.requiredColumns}</p>
          <p className="flex items-start gap-1.5 rounded-md border border-status-warning/30 bg-status-warning-bg p-2.5 text-xs text-status-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{m.upload.missingItemNotice}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={submit} disabled={uploading || !file || previewing || !preview || preview.issues.some((i) => i.level === 'ERROR')}>
              <UploadCloud className="size-4" />
              {uploading ? m.upload.uploading : existing ? m.upload.replace : m.upload.upload}
            </Button>
            <Button variant="outline" size="sm" className="text-foreground hover:text-brand-accent" asChild>
              <a href="/api/templates/inventory">
                <Download className="size-3.5" />
                {m.upload.downloadSample}
              </a>
            </Button>
            {existing && isAdmin && (
              <Button variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={resetUpload} disabled={resetting}>
                <RotateCcw className="size-4" />
                {resetting ? m.upload.resetting : m.upload.reset}
              </Button>
            )}
          </div>
        </div>
      )}

      {errorIssues.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-status-danger-bg p-3 text-xs text-status-danger">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5" />
            {m.upload.checkIssues}
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {errorIssues.slice(0, 8).map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {duplicate && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-status-danger-bg p-3 text-xs text-status-danger">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Info className="size-3.5" />
            {m.upload.duplicateTitle}
          </div>
          {m.upload.duplicateBody}
        </div>
      )}

      {existing && blocked && isAdmin && (
        <Button variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={resetUpload} disabled={resetting}>
          <RotateCcw className="size-4" />
          {resetting ? m.upload.resetting : m.upload.reset}
        </Button>
      )}

      {showInbound && <InboundManager warehouseId={warehouseId} date={date} />}
    </div>
  );
}

interface UploadJobState {
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  error: string | null;
}

/** 뒤에서 처리 중인 업로드가 끝날 때까지 1.5초 간격으로 확인한다(최대 약 15분). */
async function waitForUploadJob(jobId: string): Promise<UploadJobState> {
  for (let i = 0; i < 600; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const res = await fetch(`/api/upload/jobs/${jobId}`);
    if (!res.ok) continue;
    const job: UploadJobState = await res.json();
    if (job.status === 'SUCCEEDED' || job.status === 'FAILED') return job;
  }
  return { status: 'FAILED', result: null, error: null };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
