import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { autoLayout, parseSheets } from '@/domain/excel/parser';
import { readSheets, suggestColumns, type ImportLayout, type MatchConfidence, type LayoutField } from '@/domain/excel/layout';
import { findMatchingTemplate, layoutFingerprint, saveImportTemplate, touchImportTemplate } from '@/server/repositories/import-template-repository';
import { validateAgainstPreviousSnapshot } from '@/domain/excel/validator';
import type { ParsedInventoryRow, ValidationIssue } from '@/domain/excel/types';
import { createSnapshot, findActiveSnapshot, getLatestActiveSnapshotBefore, getSnapshotProductCodes, SnapshotConflictError } from '@/server/repositories/snapshot-repository';

export interface UploadRequest {
  /** 양식 템플릿을 찾고 저장할 조직. 없으면 템플릿 없이 자동 인식만 한다(스크립트·테스트용). */
  orgId?: string;
  /** 사용자가 확인한 양식. 없으면 저장된 템플릿 → 자동 인식 순으로 정한다. */
  layout?: ImportLayout;
  /** 주어지면 이번 양식을 이 이름의 템플릿으로 저장한다. */
  saveTemplateAs?: string;
  warehouseId: string;
  snapshotDate: Date;
  fileBuffer: Buffer;
  fileName: string;
  uploadedById: string;
  replaceExisting: boolean;
  isMock?: boolean;
}

export type UploadResult =
  | { status: 'ERROR'; issues: ValidationIssue[] }
  | {
      status: 'CONFLICT';
      existing: { snapshotId: string; uploadedAt: Date; uploadedByName: string; rowCount: number; version: number };
    }
  | {
      status: 'DUPLICATE';
      existing: { snapshotDate: Date; uploadedAt: Date; uploadedByName: string; rowCount: number };
    }
  | { status: 'SUCCESS'; snapshotId: string; rowCount: number; issues: ValidationIssue[]; fileDates: string[] };

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 실제 분석에 쓰는 최소 필드만으로 데이터 동일성을 판단한다. 파일명·헤더 순서·무시되는 부가 컬럼이
 * 달라도 상품코드/상품명/원가/원가합/정상재고가 같으면 "동일한 데이터"로 취급한다.
 */
function computeContentSignature(rows: ParsedInventoryRow[]): string {
  const normalizedRows = rows
    .map((r) => ({
      productCode: r.productCode,
      productName: r.productName,
      unitCost: r.unitCost,
      unitCostProvided: !r.costMissing,
      totalCost: r.totalCost,
      normalStock: r.normalStock,
    }))
    .sort((a, b) => a.productCode.localeCompare(b.productCode));
  return sha256(Buffer.from(JSON.stringify(normalizedRows)));
}

export interface UploadPreview {
  sheets: { name: string; rowCount: number }[];
  layout: ImportLayout;
  template: { id: string; name: string } | null;
  confidence: Partial<Record<LayoutField, MatchConfidence>>;
  /** 헤더 행 고르기용 — 선택한 시트의 위쪽 15행(열은 최대 30개). */
  topRows: string[][];
  headers: string[];
  rowCount: number;
  sample: { productCode: string; productName: string; normalStock: number; unitCost: number | null }[];
  fileDates: string[];
  issues: ValidationIssue[];
}

/**
 * 파일을 저장하지 않고 양식만 확인한다. 양식을 주지 않으면 저장된 템플릿 → 자동 인식 순으로 정한다.
 * 사용자가 화면에서 시트·헤더 행·열을 바꾸면 그 양식으로 다시 미리보기를 요청한다.
 */
export async function previewUpload(orgId: string, fileBuffer: Buffer, layout?: ImportLayout): Promise<UploadPreview | { error: string }> {
  const sheets = readSheets(fileBuffer);
  if (sheets.length === 0) return { error: '파일에서 표 데이터를 찾을 수 없습니다.' };
  const template = layout ? null : await findMatchingTemplate(orgId, sheets);
  const chosen = layout ?? template?.layout ?? autoLayout(sheets);
  const sheet = sheets.find((s) => s.name === chosen.sheetName) ?? sheets[0];
  const headers = sheet.aoa[chosen.headerRowIndex] ?? [];
  const { confidence } = suggestColumns(headers, sheet.aoa.slice(chosen.headerRowIndex + 1, chosen.headerRowIndex + 21));
  const parsed = parseSheets(sheets, chosen);
  return {
    sheets: sheets.map((s) => ({ name: s.name, rowCount: s.aoa.length })),
    layout: chosen,
    template: template ? { id: template.id, name: template.name } : null,
    confidence: template ? {} : confidence,
    topRows: sheet.aoa.slice(0, 15).map((r) => r.slice(0, 30)),
    headers,
    rowCount: parsed.rows.length,
    sample: parsed.rows
      .slice(0, 8)
      .map((r) => ({ productCode: r.productCode, productName: r.productName, normalStock: r.normalStock, unitCost: r.costMissing ? null : r.unitCost })),
    fileDates: parsed.fileDates,
    issues: parsed.issues,
  };
}

export async function processUpload(request: UploadRequest): Promise<UploadResult> {
  const sheets = readSheets(request.fileBuffer);
  if (sheets.length === 0) return { status: 'ERROR', issues: [{ level: 'ERROR', code: 'EMPTY_FILE', message: '파일에서 표 데이터를 찾을 수 없습니다.' }] };
  const template = !request.layout && request.orgId ? await findMatchingTemplate(request.orgId, sheets) : null;
  const layout = request.layout ?? template?.layout ?? autoLayout(sheets);
  const parseResult = parseSheets(sheets, layout);

  const errors = parseResult.issues.filter((i) => i.level === 'ERROR');
  if (errors.length > 0) {
    return { status: 'ERROR', issues: parseResult.issues };
  }

  const contentSignature = computeContentSignature(parseResult.rows);

  // 중복 판단은 "같은 날짜" 범위에서만 한다. 다른 날짜에 우연히 같은 재고 수치가 관측되는 것은
  // (예: 며칠간 출고가 없었던 경우) 정당한 데이터이므로 저장을 막으면 안 된다 — 막으면 소진/정체
  // 분석에 필요한 "변화 없음" 관측 자체가 사라진다.
  const existingForDate = await findActiveSnapshot(request.warehouseId, request.snapshotDate);
  if (existingForDate) {
    if (existingForDate.fileHash === contentSignature) {
      // 같은 날짜에 내용까지 동일한 재전송 → 새 버전을 만들지 않고 멱등 처리한다.
      return {
        status: 'DUPLICATE',
        existing: {
          snapshotDate: existingForDate.snapshotDate,
          uploadedAt: existingForDate.uploadedAt,
          uploadedByName: existingForDate.uploadedBy.name,
          rowCount: existingForDate.rowCount,
        },
      };
    }
    if (!request.replaceExisting) {
      return {
        status: 'CONFLICT',
        existing: {
          snapshotId: existingForDate.id,
          uploadedAt: existingForDate.uploadedAt,
          uploadedByName: existingForDate.uploadedBy.name,
          rowCount: existingForDate.rowCount,
          version: existingForDate.version,
        },
      };
    }
  }

  const previousSnapshot = await getLatestActiveSnapshotBefore(request.warehouseId, request.snapshotDate);
  const previousProductCodes = previousSnapshot ? await getSnapshotProductCodes(previousSnapshot.id) : null;
  const crossCheck = validateAgainstPreviousSnapshot(parseResult.rows, previousProductCodes);

  // 사전 확인 이후 다른 요청이 저장했을 수 있으므로, 창고 잠금 안에서 교체 허용 여부를
  // 다시 확인한다. 잠금을 사용하지 않는 외부 쓰기의 unique 충돌도 명시적인 오류로 돌려준다.
  let snapshot;
  try {
    snapshot = await createSnapshot({
      warehouseId: request.warehouseId,
      snapshotDate: request.snapshotDate,
      sourceFileName: request.fileName,
      fileHash: contentSignature,
      uploadedById: request.uploadedById,
      isMock: request.isMock ?? false,
      rows: parseResult.rows,
      replaceExisting: request.replaceExisting,
    });
  } catch (err) {
    if (err instanceof SnapshotConflictError) {
      const existing = await findActiveSnapshot(request.warehouseId, request.snapshotDate);
      if (!existing) throw err;
      if (existing.fileHash === contentSignature) {
        return {
          status: 'DUPLICATE',
          existing: {
            snapshotDate: existing.snapshotDate,
            uploadedAt: existing.uploadedAt,
            uploadedByName: existing.uploadedBy.name,
            rowCount: existing.rowCount,
          },
        };
      }
      return {
        status: 'CONFLICT',
        existing: {
          snapshotId: existing.id,
          uploadedAt: existing.uploadedAt,
          uploadedByName: existing.uploadedBy.name,
          rowCount: existing.rowCount,
          version: existing.version,
        },
      };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        status: 'ERROR',
        issues: [
          {
            level: 'ERROR',
            code: 'CONCURRENT_UPLOAD_CONFLICT',
            message: '다른 업로드가 같은 창고·기준일에 동시에 처리되어 충돌했습니다. 잠시 후 다시 시도해주세요.',
          },
        ],
      };
    }
    throw err;
  }

  if (request.orgId) {
    const fingerprint = layoutFingerprint(sheets, layout);
    if (request.saveTemplateAs && fingerprint) await saveImportTemplate(request.orgId, request.saveTemplateAs, fingerprint, layout);
    else if (template) await touchImportTemplate(request.orgId, template.id);
  }

  return {
    status: 'SUCCESS',
    snapshotId: snapshot.id,
    rowCount: parseResult.rows.length,
    issues: [...parseResult.issues, ...crossCheck.issues],
    fileDates: parseResult.fileDates,
  };
}
