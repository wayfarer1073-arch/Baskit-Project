import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';

/**
 * SKU 서술 속성(상품명·옵션·바코드·위치·파일의 위험/경고수량)의 변경 이력.
 *
 * 재고 행에 날마다 같은 글자를 반복해 저장하지 않도록, 업로드된 값이 그 날짜에 효력 있는 값과 다를 때만 한 줄 남긴다.
 * 어떤 날짜의 값은 "그 날짜 이하 중 가장 최근 버전"이다. 과거 날짜로 올리거나 지워도 이 규칙이 유지되도록
 * 기록(recordSkuAttributes)과 정리(realignSkuAttributes)가 앞뒤 버전을 함께 맞춘다.
 */
export interface SkuAttributes {
  productName: string;
  option: string | null;
  barcode: string | null;
  location: string | null;
  warningQty: number;
  dangerQty: number;
}

export interface SkuAttributeVersionRow extends SkuAttributes {
  date: string;
}

type Db = Prisma.TransactionClient | typeof prisma;

interface VersionRecord extends SkuAttributes {
  skuId: string;
  effectiveDate: Date;
}

const sameAttributes = (a: SkuAttributes, b: SkuAttributes) =>
  a.productName === b.productName && a.option === b.option && a.barcode === b.barcode && a.location === b.location && a.warningQty === b.warningQty && a.dangerQty === b.dangerQty;

const pick = (r: SkuAttributes): SkuAttributes => ({
  productName: r.productName,
  option: r.option,
  barcode: r.barcode,
  location: r.location,
  warningQty: r.warningQty,
  dangerQty: r.dangerQty,
});

/**
 * 한 날짜에 업로드된 품목들의 속성을 이력에 반영한다.
 * - 그 날짜에 효력 있는 값과 같으면 남기지 않는다(다르면 그 날짜 버전을 새로 쓰거나 덮어쓴다).
 * - 바로 다음 버전이 이번 값과 같아지면 다음 버전은 필요 없으므로 지운다(과거 날짜를 뒤늦게 올린 경우).
 */
export async function recordSkuAttributes(db: Db, date: Date, entries: { skuId: string; attributes: SkuAttributes }[]): Promise<void> {
  if (entries.length === 0) return;
  const skuIds = entries.map((e) => e.skuId);
  const [previous, following] = await Promise.all([
    db.$queryRaw<VersionRecord[]>`
      SELECT DISTINCT ON ("skuId") * FROM sku_attribute_versions
      WHERE "skuId" = ANY(${skuIds}) AND "effectiveDate" <= ${date}::date
      ORDER BY "skuId", "effectiveDate" DESC`,
    db.$queryRaw<VersionRecord[]>`
      SELECT DISTINCT ON ("skuId") * FROM sku_attribute_versions
      WHERE "skuId" = ANY(${skuIds}) AND "effectiveDate" > ${date}::date
      ORDER BY "skuId", "effectiveDate" ASC`,
  ]);
  const previousBySku = new Map(previous.map((v) => [v.skuId, v]));
  const followingBySku = new Map(following.map((v) => [v.skuId, v]));

  const writes: (SkuAttributes & { skuId: string })[] = [];
  const redundant: { skuId: string; effectiveDate: Date }[] = [];
  for (const { skuId, attributes } of entries) {
    const prev = previousBySku.get(skuId);
    if (!prev || !sameAttributes(prev, attributes)) writes.push({ skuId, ...pick(attributes) });
    const next = followingBySku.get(skuId);
    if (next && sameAttributes(next, attributes)) redundant.push({ skuId, effectiveDate: next.effectiveDate });
  }

  if (writes.length > 0) {
    const payload = JSON.stringify(writes);
    await db.$executeRaw`
      INSERT INTO sku_attribute_versions ("skuId", "effectiveDate", "productName", "option", "barcode", "location", "warningQty", "dangerQty")
      SELECT r."skuId", ${date}::date, r."productName", r.option, r.barcode, r.location, r."warningQty", r."dangerQty"
      FROM jsonb_to_recordset(${payload}::jsonb) AS r("skuId" text, "productName" text, option text, barcode text, location text, "warningQty" integer, "dangerQty" integer)
      ON CONFLICT ("skuId", "effectiveDate") DO UPDATE SET
        "productName" = EXCLUDED."productName", "option" = EXCLUDED."option", "barcode" = EXCLUDED."barcode",
        "location" = EXCLUDED."location", "warningQty" = EXCLUDED."warningQty", "dangerQty" = EXCLUDED."dangerQty"`;
  }
  if (redundant.length > 0) {
    await db.skuAttributeVersion.deleteMany({ where: { OR: redundant.map((r) => ({ skuId: r.skuId, effectiveDate: r.effectiveDate })) } });
  }
}

/**
 * 한 날짜의 관측이 사라졌을 때(업로드 초기화, 다시 올린 목록에서 빠진 품목) 그 날짜에 남긴 버전을 정리한다.
 * 다음 버전 전까지 그 품목을 다시 본 날이 있으면 버전을 그날로 옮기고(그날도 같은 값이었으므로), 없으면 지운다.
 */
export async function realignSkuAttributes(db: Db, warehouseId: string, date: Date, skuIds?: string[]): Promise<void> {
  const onlySkus = skuIds ?? null;
  await db.$executeRaw`
    WITH target AS (
      SELECT v."skuId",
        (SELECT MIN(x."effectiveDate") FROM sku_attribute_versions x WHERE x."skuId" = v."skuId" AND x."effectiveDate" > v."effectiveDate") AS next_version
      FROM sku_attribute_versions v
      JOIN skus s ON s.id = v."skuId"
      WHERE s."warehouseId" = ${warehouseId} AND v."effectiveDate" = ${date}::date
        AND (${onlySkus}::text[] IS NULL OR v."skuId" = ANY(${onlySkus}::text[]))
    ), moved AS (
      SELECT t."skuId",
        (SELECT MIN(sn."snapshotDate") FROM inventory_items ii JOIN inventory_snapshots sn ON sn.id = ii."snapshotId"
         WHERE ii."skuId" = t."skuId" AND sn.status = 'ACTIVE' AND sn."snapshotDate" > ${date}::date
           AND (t.next_version IS NULL OR sn."snapshotDate" < t.next_version)) AS move_to
      FROM target t
    )
    UPDATE sku_attribute_versions a SET "effectiveDate" = moved.move_to
    FROM moved
    WHERE a."skuId" = moved."skuId" AND a."effectiveDate" = ${date}::date AND moved.move_to IS NOT NULL`;
  await db.$executeRaw`
    DELETE FROM sku_attribute_versions a USING skus s
    WHERE s.id = a."skuId" AND s."warehouseId" = ${warehouseId} AND a."effectiveDate" = ${date}::date
      AND (${onlySkus}::text[] IS NULL OR a."skuId" = ANY(${onlySkus}::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM inventory_items ii JOIN inventory_snapshots sn ON sn.id = ii."snapshotId"
        WHERE ii."skuId" = a."skuId" AND sn.status = 'ACTIVE' AND sn."snapshotDate" = ${date}::date
      )`;
}

/** SKU별 변경 이력(날짜 오름차순). asOfDate를 주면 그 날짜 이하의 버전만. */
export async function loadSkuAttributeHistory(skuIds: string[], asOfDate?: string, db: Db = prisma): Promise<Map<string, SkuAttributeVersionRow[]>> {
  const result = new Map<string, SkuAttributeVersionRow[]>();
  if (skuIds.length === 0) return result;
  const rows = await db.skuAttributeVersion.findMany({
    where: { skuId: { in: skuIds }, ...(asOfDate ? { effectiveDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}) },
    orderBy: [{ skuId: 'asc' }, { effectiveDate: 'asc' }],
  });
  for (const r of rows) {
    const list = result.get(r.skuId) ?? [];
    list.push({ date: dateOnlyToString(r.effectiveDate), ...pick(r) });
    result.set(r.skuId, list);
  }
  return result;
}

/** 날짜 오름차순 이력에서 그 날짜에 효력 있는 값. 이력이 없거나 그 날짜보다 모두 뒤면 null. */
export function attributesAt(history: SkuAttributeVersionRow[] | undefined, date: string): SkuAttributes | null {
  if (!history) return null;
  let found: SkuAttributeVersionRow | null = null;
  for (const v of history) {
    if (v.date > date) break;
    found = v;
  }
  return found;
}
