/**
 * 이전 사내용 앱(scm-inventory, 워크스페이스 구분이 없던 버전)의 데이터를 Limenote 워크스페이스 하나로 옮긴다.
 *
 * 옮기는 것: 창고 → 일일 재고 연동 창고(DA, DB …), SKU·상품 속성 이력, 날짜별 업로드(스냅샷)와 재고 행,
 * 입고 특이사항, 소비기한 로트, 입수량 업로드 이력, 일정·재고 이벤트·변경 이력, 게시판, 공휴일, 즐겨찾기, 위험 기준 설정.
 *
 * 환경변수
 *   LEGACY_DATABASE_URL         이전 앱 DB 주소 (없으면 아무것도 하지 않고 끝난다)
 *   LEGACY_IMPORT_TARGET_EMAIL  옮겨 받을 워크스페이스의 사용자 이메일 (그 사람의 워크스페이스로 옮긴다)
 *
 * 배포 때마다 실행돼도 안전하다 — 이미 옮겼으면 건너뛴다. 전체를 한 트랜잭션으로 옮겨, 중간에 실패하면 아무것도 남지 않는다.
 * 어떤 오류가 나도 종료 코드는 0이라 앱 시작을 막지 않는다(결과는 로그로 확인).
 *
 * 작성자 연결: 이전 사용자와 이메일이 같은 계정이 대상 워크스페이스에 있으면 그 계정으로, 없으면 로그인할 수 없는
 * '이전 사용자' 계정(이름만 보존)을 만들어 기록이 끊기지 않게 한다.
 */
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { nextWarehouseCode } from '../src/server/repositories/warehouse-repository';

type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;

const log = (...args: unknown[]) => console.log('[import-legacy]', ...args);
const BATCH = 2000;

async function legacyRows(legacy: PrismaClient, sql: string): Promise<Row[]> {
  const result = await legacy.$queryRawUnsafe<{ rows: Row[] | null }[]>(`SELECT json_agg(t) AS rows FROM (${sql}) t`);
  return result[0]?.rows ?? [];
}

async function tableExists(legacy: PrismaClient, table: string): Promise<boolean> {
  const r = await legacy.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`);
  return !!r[0]?.ok;
}

async function columnExists(db: PrismaClient, table: string, column: string): Promise<boolean> {
  const r = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return Number(r[0]?.n ?? 0) > 0;
}

/** rows를 jsonb_to_recordset으로 펼쳐 한 번에 넣는다. `select`는 r.* 열을 대상 열 순서대로 고르는 식. */
async function insertRows(tx: Tx, rows: Row[], target: string, columns: string, recordset: string, select: string, conflict = 'ON CONFLICT DO NOTHING') {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const payload = JSON.stringify(rows.slice(i, i + BATCH));
    inserted += await tx.$executeRawUnsafe(`INSERT INTO ${target} (${columns}) SELECT ${select} FROM jsonb_to_recordset($1::jsonb) AS r(${recordset}) ${conflict}`, payload);
  }
  return inserted;
}

async function main() {
  const legacyUrl = process.env.LEGACY_DATABASE_URL?.trim();
  const targetEmail = process.env.LEGACY_IMPORT_TARGET_EMAIL?.trim().toLowerCase();
  if (!legacyUrl || !targetEmail) {
    log('LEGACY_DATABASE_URL / LEGACY_IMPORT_TARGET_EMAIL 이 없어 건너뜁니다.');
    return;
  }
  const target = new PrismaClient();
  const legacy = new PrismaClient({ datasourceUrl: legacyUrl });
  try {
    // 0) 이전 앱 DB가 맞는지(워크스페이스 구분이 없는 구조) 확인
    if (!(await tableExists(legacy, 'warehouses')) || (await columnExists(legacy, 'warehouses', 'organizationId'))) {
      log('이전 앱 DB 구조가 아닙니다(warehouses 표가 없거나 이미 워크스페이스 구분이 있음). 중단합니다.');
      return;
    }
    const owner = await target.user.findUnique({ where: { email: targetEmail }, select: { id: true, organizationId: true, isActive: true } });
    if (!owner || !owner.isActive) {
      log(`대상 사용자 ${targetEmail} 을(를) 찾을 수 없습니다. 중단합니다.`);
      return;
    }
    const orgId = owner.organizationId;

    const legacyWarehouses = await legacyRows(legacy, `SELECT id, code, name, "sortOrder", "createdAt" FROM warehouses ORDER BY "sortOrder", code`);
    if (legacyWarehouses.length === 0) {
      log('이전 DB에 창고가 없습니다. 옮길 것이 없습니다.');
      return;
    }
    const legacyWarehouseIds = legacyWarehouses.map((w) => String(w.id));
    const existing = await target.warehouse.findMany({ where: { id: { in: legacyWarehouseIds } }, select: { id: true, organizationId: true } });
    if (existing.some((w) => w.organizationId !== orgId)) {
      log('이전 창고가 이미 다른 워크스페이스에 들어가 있습니다. 중단합니다.');
      return;
    }
    if (existing.length === legacyWarehouseIds.length) {
      log('이미 옮겨진 데이터입니다. 건너뜁니다. (LEGACY_* 환경변수는 지워도 됩니다)');
      return;
    }

    // 사용자 매핑(트랜잭션 밖에서 비밀번호 해시를 미리 만든다 — 해시는 느리다)
    const legacyUsers = await legacyRows(legacy, `SELECT id, email, name, "createdAt" FROM users`);
    const sameEmail = await target.user.findMany({
      where: { email: { in: legacyUsers.map((u) => String(u.email).toLowerCase()) } },
      select: { id: true, email: true, organizationId: true },
    });
    const placeholderHash = await hashPassword(randomBytes(24).toString('hex'));

    const started = Date.now();
    const report = await target.$transaction(
      async (tx) => {
        const counts: Record<string, number> = {};
        // 1) 사용자
        const userMap = new Map<string, string>();
        for (const u of legacyUsers) {
          const match = sameEmail.find((t) => t.email === String(u.email).toLowerCase() && t.organizationId === orgId);
          if (match) {
            userMap.set(String(u.id), match.id);
            continue;
          }
          const created = await tx.user.create({
            data: {
              organizationId: orgId,
              email: `legacy-${String(u.id)}@legacy.invalid`,
              name: String(u.name),
              passwordHash: placeholderHash,
              role: 'MEMBER',
              isActive: false,
            },
            select: { id: true },
          });
          userMap.set(String(u.id), created.id);
        }
        counts.users = legacyUsers.length;
        const mapUser = (id: unknown) => userMap.get(String(id)) ?? owner.id;

        // 2) 창고 — 일일 재고 연동 창고로, 코드는 DA, DB … 순서로 이어서 붙인다.
        //    가입 때 자동으로 생긴 빈 일일 창고(아무 기록도 없는 것)는 지워서 이전 창고가 DA부터 받게 한다.
        const removable = await tx.warehouse.findMany({
          where: {
            organizationId: orgId,
            kind: 'STOCK',
            segment: 'DAILY_SYNC',
            skus: { none: {} },
            snapshots: { none: {} },
            events: { none: {} },
            codeAliases: { none: {} },
            packagingUpload: null,
          },
          select: { id: true },
        });
        if (removable.length) await tx.warehouse.deleteMany({ where: { id: { in: removable.map((w) => w.id) } } });
        counts.removedEmptyWarehouses = removable.length;
        const usedCodes = new Set((await tx.warehouse.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((w) => w.code));
        const maxSort = (await tx.warehouse.aggregate({ where: { organizationId: orgId, kind: 'STOCK' }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
        let sort = maxSort;
        for (const w of legacyWarehouses) {
          const code = nextWarehouseCode(usedCodes, 'DAILY_SYNC');
          usedCodes.add(code);
          await tx.warehouse.create({
            data: {
              id: String(w.id),
              organizationId: orgId,
              code,
              name: String(w.name),
              sortOrder: ++sort,
              kind: 'STOCK',
              segment: 'DAILY_SYNC',
              createdAt: new Date(String(w.createdAt)),
            },
          });
        }
        counts.warehouses = legacyWarehouses.length;

        // 3) SKU
        const skus = await legacyRows(
          legacy,
          `SELECT id, "warehouseId", "productCode", "currentProductName", "currentOption", "currentBarcode", "currentLocation", "currentUnitCost",
                  "currentWarningQty", "currentDangerQty", "manualWarningQty", "manualDangerQty", "isB2B", "firstSeenDate", "lastSeenDate", "isActive",
                  "soldOutDetectedDate", "isHiddenFromDashboard", "expirationDate", "expirationRiskDays", "eaPerBox", "eaPerPallet", "packagingBarcode",
                  "createdAt", "updatedAt" FROM skus`,
        );
        counts.skus = await insertRows(
          tx,
          skus,
          'skus',
          `id, "warehouseId", "productCode", "currentProductName", "currentOption", "currentBarcode", "currentLocation", "currentUnitCost", "currentWarningQty", "currentDangerQty", "manualWarningQty", "manualDangerQty", "isB2B", "firstSeenDate", "lastSeenDate", "isActive", "soldOutDetectedDate", "isHiddenFromDashboard", "expirationDate", "expirationRiskDays", "eaPerBox", "eaPerPallet", "packagingBarcode", "createdAt", "updatedAt"`,
          `id text, "warehouseId" text, "productCode" text, "currentProductName" text, "currentOption" text, "currentBarcode" text, "currentLocation" text, "currentUnitCost" numeric, "currentWarningQty" int, "currentDangerQty" int, "manualWarningQty" int, "manualDangerQty" int, "isB2B" boolean, "firstSeenDate" date, "lastSeenDate" date, "isActive" boolean, "soldOutDetectedDate" date, "isHiddenFromDashboard" boolean, "expirationDate" date, "expirationRiskDays" int, "eaPerBox" int, "eaPerPallet" int, "packagingBarcode" text, "createdAt" timestamp, "updatedAt" timestamp`,
          `r.id, r."warehouseId", r."productCode", r."currentProductName", r."currentOption", r."currentBarcode", r."currentLocation", r."currentUnitCost", r."currentWarningQty", r."currentDangerQty", r."manualWarningQty", r."manualDangerQty", r."isB2B", r."firstSeenDate", r."lastSeenDate", r."isActive", r."soldOutDetectedDate", r."isHiddenFromDashboard", r."expirationDate", r."expirationRiskDays", r."eaPerBox", r."eaPerPallet", r."packagingBarcode", r."createdAt", r."updatedAt"`,
        );

        // 4) 상품 속성 이력 — 유효한 업로드에서 값이 바뀐 날만(현재 앱의 저장 방식)
        const versions = await legacyRows(
          legacy,
          `SELECT "skuId", d AS "effectiveDate", "productName", "option", "barcode", "location", "warningQty", "dangerQty" FROM (
             SELECT i."skuId", s."snapshotDate" AS d, i."productName", i."option", i."barcode", i."location", i."warningQty", i."dangerQty",
                    ROW(i."productName", i."option", i."barcode", i."location", i."warningQty", i."dangerQty") AS cur,
                    LAG(ROW(i."productName", i."option", i."barcode", i."location", i."warningQty", i."dangerQty")) OVER (PARTITION BY i."skuId" ORDER BY s."snapshotDate") AS prev
             FROM inventory_items i JOIN inventory_snapshots s ON s.id = i."snapshotId" WHERE s.status = 'ACTIVE'
           ) t WHERE prev IS DISTINCT FROM cur`,
        );
        counts.attributeVersions = await insertRows(
          tx,
          versions,
          'sku_attribute_versions',
          `"skuId", "effectiveDate", "productName", "option", "barcode", "location", "warningQty", "dangerQty"`,
          `"skuId" text, "effectiveDate" date, "productName" text, "option" text, "barcode" text, "location" text, "warningQty" int, "dangerQty" int`,
          `r."skuId", r."effectiveDate", r."productName", r."option", r."barcode", r."location", r."warningQty", r."dangerQty"`,
        );

        // 5) 업로드(스냅샷)
        const snapshots = await legacyRows(
          legacy,
          `SELECT id, "warehouseId", "snapshotDate", version, status, "sourceFileName", "fileHash", "rowCount", "isMock", "uploadedById", "uploadedAt" FROM inventory_snapshots`,
        );
        counts.snapshots = await insertRows(
          tx,
          snapshots.map((s) => ({ ...s, uploadedById: mapUser(s.uploadedById) })),
          'inventory_snapshots',
          `id, "warehouseId", "snapshotDate", version, status, "sourceFileName", "fileHash", "rowCount", "isMock", "uploadedById", "uploadedAt"`,
          `id text, "warehouseId" text, "snapshotDate" date, version int, status text, "sourceFileName" text, "fileHash" text, "rowCount" int, "isMock" boolean, "uploadedById" text, "uploadedAt" timestamp`,
          `r.id, r."warehouseId", r."snapshotDate", r.version, r.status::"SnapshotStatus", r."sourceFileName", r."fileHash", r."rowCount", r."isMock", r."uploadedById", r."uploadedAt"`,
        );

        // 6) 재고 행 — 유효한 업로드만(덮어쓴 버전의 행은 현재 앱도 남기지 않는다). 스냅샷 단위로 나눠 읽는다.
        const activeIds = snapshots.filter((s) => s.status === 'ACTIVE').map((s) => String(s.id));
        counts.items = 0;
        for (let i = 0; i < activeIds.length; i += 20) {
          const ids = activeIds
            .slice(i, i + 20)
            .map((id) => `'${id.replace(/'/g, "''")}'`)
            .join(',');
          const items = await legacyRows(
            legacy,
            `SELECT "snapshotId", "skuId", "unitCost", "unitCostProvided", "totalCost", "normalStock", "defectiveStock", "incomingStock", extra FROM inventory_items WHERE "snapshotId" IN (${ids})`,
          );
          counts.items += await insertRows(
            tx,
            items,
            'inventory_items',
            `"snapshotId", "skuId", "unitCost", "unitCostProvided", "totalCost", "normalStock", "defectiveStock", "incomingStock", extra`,
            `"snapshotId" text, "skuId" text, "unitCost" numeric, "unitCostProvided" boolean, "totalCost" numeric, "normalStock" int, "defectiveStock" int, "incomingStock" int, extra jsonb`,
            `r."snapshotId", r."skuId", r."unitCost", r."unitCostProvided", r."totalCost", r."normalStock", r."defectiveStock", r."incomingStock", r.extra`,
          );
        }

        // 7) 입고 특이사항
        if (await tableExists(legacy, 'snapshot_inbounds')) {
          const inbounds = await legacyRows(legacy, `SELECT id, "skuId", "snapshotDate", "productCode", "productName", quantity, "createdAt" FROM snapshot_inbounds`);
          counts.inbounds = await insertRows(
            tx,
            inbounds,
            'snapshot_inbounds',
            `id, "skuId", "snapshotDate", "productCode", "productName", quantity, "createdAt"`,
            `id text, "skuId" text, "snapshotDate" date, "productCode" text, "productName" text, quantity int, "createdAt" timestamp`,
            `r.id, r."skuId", r."snapshotDate", r."productCode", r."productName", r.quantity, r."createdAt"`,
          );
        }

        // 8) 소비기한 로트·입수량 업로드 이력
        if (await tableExists(legacy, 'sku_expiration_lots')) {
          const lots = await legacyRows(legacy, `SELECT id, "skuId", lot, "isAutoLot", "expirationDate", "createdAt", "updatedAt" FROM sku_expiration_lots`);
          counts.expirationLots = await insertRows(
            tx,
            lots,
            'sku_expiration_lots',
            `id, "skuId", lot, "isAutoLot", "expirationDate", "createdAt", "updatedAt"`,
            `id text, "skuId" text, lot text, "isAutoLot" boolean, "expirationDate" date, "createdAt" timestamp, "updatedAt" timestamp`,
            `r.id, r."skuId", r.lot, r."isAutoLot", r."expirationDate", r."createdAt", r."updatedAt"`,
          );
        }
        if (await tableExists(legacy, 'sku_packaging_uploads')) {
          const uploads = await legacyRows(legacy, `SELECT id, "warehouseId", "sourceFileName", "rowCount", "uploadedById", "uploadedAt" FROM sku_packaging_uploads`);
          counts.packagingUploads = await insertRows(
            tx,
            uploads.map((u) => ({ ...u, uploadedById: mapUser(u.uploadedById) })),
            'sku_packaging_uploads',
            `id, "warehouseId", "sourceFileName", "rowCount", "uploadedById", "uploadedAt"`,
            `id text, "warehouseId" text, "sourceFileName" text, "rowCount" int, "uploadedById" text, "uploadedAt" timestamp`,
            `r.id, r."warehouseId", r."sourceFileName", r."rowCount", r."uploadedById", r."uploadedAt"`,
          );
        }

        // 9) 일정 — 같은 일정(종류·제목·기간)이 이미 있으면 그 일정에 묶는다.
        const scheduleMap = new Map<string, string>();
        if (await tableExists(legacy, 'event_schedules')) {
          const schedules = await legacyRows(legacy, `SELECT id, "eventType", title, "startDate", "endDate", color, "createdAt", "updatedAt" FROM event_schedules`);
          counts.schedules = await insertRows(
            tx,
            schedules.map((s) => ({ ...s, organizationId: orgId })),
            'event_schedules',
            `id, "organizationId", "eventType", title, "startDate", "endDate", color, "createdAt", "updatedAt"`,
            `id text, "organizationId" text, "eventType" text, title text, "startDate" date, "endDate" date, color text, "createdAt" timestamp, "updatedAt" timestamp`,
            `r.id, r."organizationId", r."eventType"::"EventType", r.title, r."startDate", r."endDate", r.color, r."createdAt", r."updatedAt"`,
          );
          for (const s of schedules) {
            const found = await tx.eventSchedule.findFirst({
              where: {
                organizationId: orgId,
                eventType: s.eventType as never,
                title: String(s.title),
                startDate: new Date(`${s.startDate}T00:00:00.000Z`),
                endDate: new Date(`${s.endDate}T00:00:00.000Z`),
              },
              select: { id: true },
            });
            if (found) scheduleMap.set(String(s.id), found.id);
          }
        }

        // 10) 재고 이벤트·변경 이력
        const hasScheduleCol = await columnExists(legacy, 'inventory_events', 'scheduleId');
        const hasEndDate = await columnExists(legacy, 'inventory_events', 'endDate');
        const hasTitle = await columnExists(legacy, 'inventory_events', 'title');
        const events = await legacyRows(
          legacy,
          `SELECT id, "warehouseId", "skuId", "eventType", quantity, note, "eventDate", ${hasEndDate ? '"endDate"' : 'NULL AS "endDate"'}, ${hasTitle ? 'title' : 'NULL AS title'},
                  ${hasScheduleCol ? '"scheduleId"' : 'NULL AS "scheduleId"'}, "isAutoGenerated", "isDeleted", "createdById", "createdAt", "updatedAt" FROM inventory_events`,
        );
        counts.events = await insertRows(
          tx,
          events.map((e) => ({ ...e, createdById: mapUser(e.createdById), scheduleId: e.scheduleId ? (scheduleMap.get(String(e.scheduleId)) ?? null) : null })),
          'inventory_events',
          `id, "warehouseId", "skuId", "eventType", quantity, note, "eventDate", "endDate", title, "scheduleId", "isAutoGenerated", "isDeleted", "createdById", "createdAt", "updatedAt"`,
          `id text, "warehouseId" text, "skuId" text, "eventType" text, quantity int, note text, "eventDate" timestamp, "endDate" date, title text, "scheduleId" text, "isAutoGenerated" boolean, "isDeleted" boolean, "createdById" text, "createdAt" timestamp, "updatedAt" timestamp`,
          `r.id, r."warehouseId", r."skuId", r."eventType"::"EventType", r.quantity, r.note, r."eventDate", r."endDate", r.title, r."scheduleId", r."isAutoGenerated", r."isDeleted", r."createdById", r."createdAt", r."updatedAt"`,
        );
        const histories = await legacyRows(legacy, `SELECT id, "eventId", "changeType", "previousData", "changedById", "changedAt" FROM event_histories`);
        counts.eventHistories = await insertRows(
          tx,
          histories.map((h) => ({ ...h, changedById: mapUser(h.changedById) })),
          'event_histories',
          `id, "eventId", "changeType", "previousData", "changedById", "changedAt"`,
          `id text, "eventId" text, "changeType" text, "previousData" jsonb, "changedById" text, "changedAt" timestamp`,
          `r.id, r."eventId", r."changeType"::"EventChangeType", r."previousData", r."changedById", r."changedAt"`,
        );

        // 11) 게시판
        if (await tableExists(legacy, 'posts')) {
          const posts = await legacyRows(legacy, `SELECT id, tag, title, body, "authorId", "createdAt", "updatedAt" FROM posts`);
          counts.posts = await insertRows(
            tx,
            posts.map((p) => ({ ...p, authorId: mapUser(p.authorId), organizationId: orgId })),
            'posts',
            `id, "organizationId", tag, title, body, "authorId", "createdAt", "updatedAt"`,
            `id text, "organizationId" text, tag text, title text, body text, "authorId" text, "createdAt" timestamp, "updatedAt" timestamp`,
            `r.id, r."organizationId", r.tag::"PostTag", r.title, r.body, r."authorId", r."createdAt", r."updatedAt"`,
          );
        }

        // 12) 공휴일 — 같은 날짜가 이미 있으면 그대로 둔다.
        if (await tableExists(legacy, 'holidays')) {
          const holidays = await legacyRows(legacy, `SELECT id, date, name, "createdAt" FROM holidays`);
          counts.holidays = await insertRows(
            tx,
            holidays.map((h) => ({ ...h, organizationId: orgId })),
            'holidays',
            `id, "organizationId", date, name, "createdAt"`,
            `id text, "organizationId" text, date date, name text, "createdAt" timestamp`,
            `r.id, r."organizationId", r.date, r.name, r."createdAt"`,
          );
        }

        // 13) 즐겨찾기 — 실제 계정으로 연결된 사용자 것만
        if (await tableExists(legacy, 'sku_favorites')) {
          const favorites = await legacyRows(legacy, `SELECT id, "userId", "skuId", "createdAt" FROM sku_favorites`);
          const realUsers = new Set(sameEmail.filter((u) => u.organizationId === orgId).map((u) => u.id));
          counts.favorites = await insertRows(
            tx,
            favorites.map((f) => ({ ...f, userId: mapUser(f.userId) })).filter((f) => realUsers.has(String(f.userId))),
            'sku_favorites',
            `id, "userId", "skuId", "createdAt"`,
            `id text, "userId" text, "skuId" text, "createdAt" timestamp`,
            `r.id, r."userId", r."skuId", r."createdAt"`,
          );
        }

        // 14) 위험·정체 판단 기준
        const settings = await legacyRows(legacy, `SELECT "stockoutSoonDays", "manageMaxDays", "overstockCoverageDays", "stagnantDays" FROM settings LIMIT 1`);
        if (settings[0]) {
          const s = settings[0] as { stockoutSoonDays: number; manageMaxDays: number; overstockCoverageDays: number; stagnantDays: number };
          const values = { stockoutSoonDays: s.stockoutSoonDays, manageMaxDays: s.manageMaxDays, overstockCoverageDays: s.overstockCoverageDays, stagnantDays: s.stagnantDays };
          await tx.settings.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...values }, update: values });
        }

        // 15) 일일 재고 연동이 꺼져 있으면 켠다.
        const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { disabledSegments: true } });
        if (org.disabledSegments.includes('DAILY_SYNC')) {
          await tx.organization.update({ where: { id: orgId }, data: { disabledSegments: org.disabledSegments.filter((s) => s !== 'DAILY_SYNC') } });
        }
        return counts;
      },
      { timeout: 15 * 60_000, maxWait: 60_000 },
    );
    log(`완료 (${Math.round((Date.now() - started) / 1000)}초):`, JSON.stringify(report));
  } finally {
    await Promise.all([target.$disconnect(), legacy.$disconnect()]);
  }
}

main().catch((e) => {
  // 앱 시작을 막지 않도록 실패도 로그만 남기고 0으로 끝낸다. 트랜잭션이라 중간 결과는 남지 않는다.
  console.error('[import-legacy] 실패 — 아무것도 바뀌지 않았습니다:', e instanceof Error ? e.message : e);
});
