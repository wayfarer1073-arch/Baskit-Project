import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { autoLayout, parseSheets } from '@/domain/excel/parser';
import { readSheets, suggestColumns, type ImportLayout, type MatchConfidence, type LayoutField, type SheetData } from '@/domain/excel/layout';
import { SpreadsheetRejectedError } from '@/domain/excel/aoa-reader';
import { applyCodeAliases, assignAutoCodes, convertStockUnit, markZeroStock } from '@/domain/excel/normalize';
import { loadAliasMap, loadWarehouseSkuInfo } from '@/server/repositories/code-alias-repository';
import { findMatchingTemplate, layoutFingerprint, saveImportTemplate, touchImportTemplate } from '@/server/repositories/import-template-repository';
import { validateAgainstPreviousSnapshot } from '@/domain/excel/validator';
import { applyStockFileExtras } from '@/server/repositories/stock-extras-repository';
import { storeUploadFile } from '@/server/repositories/upload-file-repository';
import type { ParsedInventoryRow, ValidationIssue } from '@/domain/excel/types';
import { manualRowsForDate, skusMissingFromUpload, type MissingSku } from '@/server/repositories/count-repository';
import { prisma } from '@/lib/prisma';
import type { StockSegment } from '@/server/repositories/warehouse-repository';
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
  | { status: 'SUCCESS'; snapshotId: string; rowCount: number; issues: ValidationIssue[]; fileDates: string[]; newCodes: string[] };

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
      // 부가 정보는 있을 때만 넣는다 — 부가 열이 없는 파일의 서명은 예전과 같게 유지된다.
      zs: r.zeroStockStatus,
      ext: r.barcode || r.eaPerBox != null || r.eaPerPallet != null || r.expirationDates?.length ? [r.barcode, r.eaPerBox, r.eaPerPallet, r.expirationDates] : undefined,
    }))
    .sort((a, b) => a.productCode.localeCompare(b.productCode));
  return sha256(Buffer.from(JSON.stringify(normalizedRows)));
}

/**
 * 파싱한 행을 창고 기준으로 맞춘다: 연결된 상품코드를 기존 SKU로 바꾸고, 박스·팔레트 단위면 낱개로 환산한다.
 * 처음 보는 상품코드도 함께 돌려준다(업로드 뒤 '새 상품' 안내용).
 */
async function normalizeForWarehouse(warehouseId: string | undefined, rows: ParsedInventoryRow[], layout: ImportLayout) {
  if (!warehouseId) return { rows: markZeroStock(assignAutoCodes(rows, new Map(), new Set()).rows, layout.zeroStockAsSoldOut), issues: [] as ValidationIssue[], newCodes: [] as string[] };
  const [aliasMap, info] = await Promise.all([loadAliasMap(warehouseId), loadWarehouseSkuInfo(warehouseId)]);
  const coded = assignAutoCodes(rows, info.codeByName, info.knownCodes);
  const aliased = applyCodeAliases(coded.rows, aliasMap);
  const converted = convertStockUnit(aliased.rows, layout.stockUnit ?? 'EA', info.factors);
  const issues: ValidationIssue[] = [...converted.issues];
  if (coded.assigned > 0) issues.push({ level: 'WARNING', code: 'AUTO_CODE_ASSIGNED', message: `상품코드 열이 없어 처음 보는 상품 ${coded.assigned}개에 코드를 자동으로 붙였습니다(A0001 형식).` });
  if (aliased.aliased > 0) issues.push({ level: 'WARNING', code: 'CODE_ALIAS_APPLIED', message: `연결된 상품코드 ${aliased.aliased}개를 기존 상품으로 바꿔 저장합니다.` });
  // 창고에 첫 업로드면 전부 새 상품이라 알릴 필요가 없다.
  const newCodes = info.knownCodes.size === 0 ? [] : converted.rows.filter((r) => !info.knownCodes.has(r.productCode)).map((r) => r.productCode);
  return { rows: markZeroStock(converted.rows, layout.zeroStockAsSoldOut), issues, newCodes };
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
  /** 창고에 처음 들어오는 상품코드(창고를 지정한 경우). */
  newCodes: string[];
  /** 이대로 올리면 품절로 처리될 기존 SKU(창고·날짜를 지정한 경우) — 저장 전에 한 번 더 확인시킨다. */
  missingSkus: MissingSku[];
}

/** 업로드 양식은 방식(일일 재고 연동·비정기 실사)마다 따로 둔다 — 창고의 방식을 따른다. 창고를 모르면 일일 재고 연동. */
async function segmentOfWarehouse(warehouseId?: string): Promise<StockSegment> {
  if (!warehouseId) return 'DAILY_SYNC';
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { segment: true } });
  return warehouse?.segment === 'PERIODIC_COUNT' ? 'PERIODIC_COUNT' : 'DAILY_SYNC';
}

/**
 * 파일을 저장하지 않고 양식만 확인한다. 양식을 주지 않으면 저장된 템플릿 → 자동 인식 순으로 정한다.
 * 사용자가 화면에서 시트·헤더 행·열을 바꾸면 그 양식으로 다시 미리보기를 요청한다.
 */
export async function previewUpload(orgId: string, fileBuffer: Buffer, layout?: ImportLayout, warehouseId?: string, snapshotDate?: string): Promise<UploadPreview | { error: string }> {
  let sheets: SheetData[];
  try {
    sheets = readSheets(fileBuffer);
  } catch (e) {
    if (e instanceof SpreadsheetRejectedError) return { error: e.message };
    throw e;
  }
  if (sheets.length === 0) return { error: '파일에서 표 데이터를 찾을 수 없습니다.' };
  const template = layout ? null : await findMatchingTemplate(orgId, await segmentOfWarehouse(warehouseId), sheets);
  const chosen = layout ?? template?.layout ?? autoLayout(sheets);
  const sheet = sheets.find((s) => s.name === chosen.sheetName) ?? sheets[0];
  const headers = sheet.aoa[chosen.headerRowIndex] ?? [];
  const { confidence } = suggestColumns(headers, sheet.aoa.slice(chosen.headerRowIndex + 1, chosen.headerRowIndex + 21));
  const parsed = parseSheets(sheets, chosen);
  const normalized = parsed.issues.some((i) => i.level === 'ERROR')
    ? { rows: parsed.rows, issues: [], newCodes: [] }
    : await normalizeForWarehouse(warehouseId, parsed.rows, chosen);
  const canCompare = warehouseId && snapshotDate && normalized.rows.length > 0 && !parsed.issues.some((i) => i.level === 'ERROR');
  const missingSkus = canCompare
    ? await skusMissingFromUpload(warehouseId, new Date(`${snapshotDate}T00:00:00.000Z`), normalized.rows.map((r) => r.productCode))
    : [];
  return {
    sheets: sheets.map((s) => ({ name: s.name, rowCount: s.aoa.length })),
    layout: chosen,
    template: template ? { id: template.id, name: template.name } : null,
    confidence: template ? {} : confidence,
    topRows: sheet.aoa.slice(0, 15).map((r) => r.slice(0, 30)),
    headers,
    rowCount: normalized.rows.length,
    sample: normalized.rows
      .slice(0, 8)
      .map((r) => ({ productCode: r.productCode, productName: r.productName, normalStock: r.normalStock, unitCost: r.costMissing ? null : r.unitCost })),
    fileDates: parsed.fileDates,
    issues: [...parsed.issues, ...normalized.issues],
    newCodes: normalized.newCodes,
    missingSkus,
  };
}

export async function processUpload(request: UploadRequest): Promise<UploadResult> {
  let sheets: SheetData[];
  try {
    sheets = readSheets(request.fileBuffer);
  } catch (e) {
    if (e instanceof SpreadsheetRejectedError) return { status: 'ERROR', issues: [{ level: 'ERROR', code: 'FILE_REJECTED', message: e.message }] };
    throw e;
  }
  if (sheets.length === 0) return { status: 'ERROR', issues: [{ level: 'ERROR', code: 'EMPTY_FILE', message: '파일에서 표 데이터를 찾을 수 없습니다.' }] };
  const segment = await segmentOfWarehouse(request.warehouseId);
  const template = !request.layout && request.orgId ? await findMatchingTemplate(request.orgId, segment, sheets) : null;
  const layout = request.layout ?? template?.layout ?? autoLayout(sheets);
  const parsed = parseSheets(sheets, layout);
  const normalized = parsed.issues.some((i) => i.level === 'ERROR')
    ? { rows: parsed.rows, issues: [], newCodes: [] }
    : await normalizeForWarehouse(request.warehouseId, parsed.rows, layout);
  const parseResult = { ...parsed, rows: normalized.rows, issues: [...parsed.issues, ...normalized.issues] };

  const errors = parseResult.issues.filter((i) => i.level === 'ERROR');
  if (errors.length > 0) {
    return { status: 'ERROR', issues: parseResult.issues };
  }
  if (parseResult.rows.length === 0) {
    return {
      status: 'ERROR',
      issues: [...parseResult.issues, { level: 'ERROR', code: 'NO_ROWS_AFTER_NORMALIZE', message: '저장할 수 있는 품목이 없습니다. 경고 내용을 확인해 주세요.' }],
    };
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
  // 같은 날 직접 입력한 상품 중 이번 파일에 없는 것은 교체해도 남긴다(합치기) — 엑셀에 있으면 엑셀 값이 이긴다.
  const fileCodes = new Set(parseResult.rows.map((r) => r.productCode));
  const keptManualRows = existingForDate ? (await manualRowsForDate(request.warehouseId, request.snapshotDate)).filter((r) => !fileCodes.has(r.productCode)) : [];
  const rowsToSave = keptManualRows.length
    ? [...parseResult.rows, ...keptManualRows.map((r, i) => ({ ...r, rowNumber: parseResult.rows.length + i + 1 }))]
    : parseResult.rows;

  let snapshot;
  try {
    snapshot = await createSnapshot({
      warehouseId: request.warehouseId,
      snapshotDate: request.snapshotDate,
      sourceFileName: request.fileName,
      fileHash: contentSignature,
      uploadedById: request.uploadedById,
      isMock: request.isMock ?? false,
      rows: rowsToSave,
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

  await applyStockFileExtras(request.warehouseId, request.snapshotDate, parseResult.rows);
  // 원본 파일을 업로드 버전과 함께 보관한다(검증용 mock 데이터는 제외).
  if (!request.isMock) await storeUploadFile({ snapshotId: snapshot.id, fileName: request.fileName, buffer: request.fileBuffer });

  if (request.orgId) {
    const fingerprint = layoutFingerprint(sheets, layout);
    if (request.saveTemplateAs && fingerprint) await saveImportTemplate(request.orgId, segment, request.saveTemplateAs, fingerprint, layout);
    else if (template) await touchImportTemplate(request.orgId, template.id);
  }

  return {
    status: 'SUCCESS',
    snapshotId: snapshot.id,
    rowCount: parseResult.rows.length,
    issues: [...parseResult.issues, ...crossCheck.issues],
    fileDates: parseResult.fileDates,
    newCodes: normalized.newCodes,
  };
}
