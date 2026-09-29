import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { headerFingerprint, LAYOUT_FIELDS, type DuplicateMode, type ImportLayout, type SheetData } from '@/domain/excel/layout';

export interface ImportTemplateRow {
  id: string;
  name: string;
  layout: ImportLayout;
  lastUsedAt: string | null;
  updatedAt: string;
}

type TemplateRecord = Prisma.ImportTemplateGetPayload<object>;

function toLayout(t: TemplateRecord): ImportLayout {
  const raw = (t.columns ?? {}) as Record<string, unknown>;
  const columns: ImportLayout['columns'] = {};
  for (const field of LAYOUT_FIELDS) if (typeof raw[field] === 'string') columns[field] = raw[field] as string;
  return { sheetName: t.sheetName, headerRowIndex: t.headerRowIndex, columns, duplicateMode: (t.duplicateMode === 'skip' ? 'skip' : 'sum') as DuplicateMode };
}

function toRow(t: TemplateRecord): ImportTemplateRow {
  return { id: t.id, name: t.name, layout: toLayout(t), lastUsedAt: t.lastUsedAt?.toISOString() ?? null, updatedAt: t.updatedAt.toISOString() };
}

export async function listImportTemplates(orgId: string): Promise<ImportTemplateRow[]> {
  const rows = await prisma.importTemplate.findMany({ where: { organizationId: orgId }, orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }] });
  return rows.map(toRow);
}

/** 레이아웃이 가리키는 헤더 행의 지문. 시트나 행이 없으면 null. */
export function layoutFingerprint(sheets: SheetData[], layout: Pick<ImportLayout, 'sheetName' | 'headerRowIndex'>): string | null {
  const sheet = layout.sheetName ? sheets.find((s) => s.name === layout.sheetName) : sheets[0];
  const header = sheet?.aoa[layout.headerRowIndex];
  return header ? headerFingerprint(header) : null;
}

/** 저장된 템플릿 중 이 파일과 같은 양식(같은 시트·헤더 행의 열 이름 집합)을 찾는다. */
export async function findMatchingTemplate(orgId: string, sheets: SheetData[]): Promise<ImportTemplateRow | null> {
  const templates = await prisma.importTemplate.findMany({ where: { organizationId: orgId }, orderBy: { lastUsedAt: { sort: 'desc', nulls: 'last' } } });
  for (const t of templates) {
    if (layoutFingerprint(sheets, { sheetName: t.sheetName, headerRowIndex: t.headerRowIndex }) === t.fingerprint) return toRow(t);
  }
  return null;
}

/** 같은 양식(지문)이 이미 있으면 이름과 열 지정을 갱신하고, 없으면 새로 만든다. */
export async function saveImportTemplate(orgId: string, name: string, fingerprint: string, layout: ImportLayout) {
  const data = {
    name,
    sheetName: layout.sheetName,
    headerRowIndex: layout.headerRowIndex,
    columns: layout.columns as Prisma.InputJsonValue,
    duplicateMode: layout.duplicateMode,
    lastUsedAt: new Date(),
  };
  return prisma.importTemplate.upsert({
    where: { organizationId_fingerprint: { organizationId: orgId, fingerprint } },
    create: { organizationId: orgId, fingerprint, ...data },
    update: data,
  });
}

export async function touchImportTemplate(orgId: string, id: string) {
  await prisma.importTemplate.updateMany({ where: { id, organizationId: orgId }, data: { lastUsedAt: new Date() } });
}

export async function renameImportTemplate(orgId: string, id: string, name: string) {
  const result = await prisma.importTemplate.updateMany({ where: { id, organizationId: orgId }, data: { name } });
  return result.count > 0;
}

export async function deleteImportTemplate(orgId: string, id: string) {
  const result = await prisma.importTemplate.deleteMany({ where: { id, organizationId: orgId } });
  return result.count > 0;
}
