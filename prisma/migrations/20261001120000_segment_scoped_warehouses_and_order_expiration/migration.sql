-- DropIndex
DROP INDEX "import_templates_organizationId_fingerprint_key";

-- AlterTable
ALTER TABLE "import_templates" ADD COLUMN     "segment" "BusinessSegment" NOT NULL DEFAULT 'DAILY_SYNC';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "expirationDate" DATE;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "segment" "BusinessSegment" NOT NULL DEFAULT 'DAILY_SYNC';

-- 기존 창고·양식의 방식: 매장 품목 가상 창고는 매장 발주 예측, 비정기 실사를 기본 방식으로 가입한 조직의 창고·양식은 비정기 실사,
-- 나머지는 일일 재고 연동.
UPDATE "warehouses" SET "segment" = 'ORDER_CYCLE' WHERE "kind" = 'STORE';
UPDATE "warehouses" w SET "segment" = 'PERIODIC_COUNT'
  FROM "organizations" o WHERE o.id = w."organizationId" AND w."kind" = 'STOCK' AND o."segment" = 'PERIODIC_COUNT';
UPDATE "import_templates" t SET "segment" = 'PERIODIC_COUNT'
  FROM "organizations" o WHERE o.id = t."organizationId" AND o."segment" = 'PERIODIC_COUNT';

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_organizationId_segment_fingerprint_key" ON "import_templates"("organizationId", "segment", "fingerprint");

-- CreateIndex
CREATE INDEX "warehouses_organizationId_segment_idx" ON "warehouses"("organizationId", "segment");

