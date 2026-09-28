-- 멀티테넌시 도입. 기존 데이터(단일 회사 시절)는 전부 "기본 워크스페이스" 하나로 옮긴 뒤
-- organizationId를 NOT NULL로 만든다. 데이터가 전혀 없는 새 DB에는 기본 조직을 만들지 않는다.

CREATE TYPE "BusinessSegment" AS ENUM ('DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE');

CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" "BusinessSegment" NOT NULL DEFAULT 'DAILY_SYNC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "organizations" ("id", "name", "segment", "updatedAt")
SELECT 'org_default', '기본 워크스페이스', 'DAILY_SYNC', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "warehouses")
   OR EXISTS (SELECT 1 FROM "settings") OR EXISTS (SELECT 1 FROM "holidays")
   OR EXISTS (SELECT 1 FROM "posts") OR EXISTS (SELECT 1 FROM "event_schedules");

-- users
ALTER TABLE "users" ADD COLUMN "organizationId" TEXT;
UPDATE "users" SET "organizationId" = 'org_default';
ALTER TABLE "users" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- warehouses
DROP INDEX "warehouses_code_key";
ALTER TABLE "warehouses" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "warehouses" ADD COLUMN "organizationId" TEXT;
UPDATE "warehouses" SET "organizationId" = 'org_default';
ALTER TABLE "warehouses" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "warehouses_organizationId_idx" ON "warehouses"("organizationId");
CREATE UNIQUE INDEX "warehouses_organizationId_code_key" ON "warehouses"("organizationId", "code");
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- event_schedules
DROP INDEX "event_schedules_eventType_title_startDate_endDate_key";
DROP INDEX "event_schedules_startDate_endDate_idx";
ALTER TABLE "event_schedules" ADD COLUMN "organizationId" TEXT;
UPDATE "event_schedules" SET "organizationId" = 'org_default';
ALTER TABLE "event_schedules" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "event_schedules_organizationId_startDate_endDate_idx" ON "event_schedules"("organizationId", "startDate", "endDate");
CREATE UNIQUE INDEX "event_schedules_organizationId_eventType_title_startDate_en_key" ON "event_schedules"("organizationId", "eventType", "title", "startDate", "endDate");
ALTER TABLE "event_schedules" ADD CONSTRAINT "event_schedules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- posts
DROP INDEX "posts_createdAt_idx";
ALTER TABLE "posts" ADD COLUMN "organizationId" TEXT;
UPDATE "posts" SET "organizationId" = 'org_default';
ALTER TABLE "posts" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "posts_organizationId_createdAt_idx" ON "posts"("organizationId", "createdAt");
ALTER TABLE "posts" ADD CONSTRAINT "posts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- holidays
DROP INDEX "holidays_date_key";
ALTER TABLE "holidays" ADD COLUMN "organizationId" TEXT;
UPDATE "holidays" SET "organizationId" = 'org_default';
ALTER TABLE "holidays" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE UNIQUE INDEX "holidays_organizationId_date_key" ON "holidays"("organizationId", "date");
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- settings: 단일 행(id=1) → 조직당 한 행(organizationId가 PK)
ALTER TABLE "settings" ADD COLUMN "organizationId" TEXT;
UPDATE "settings" SET "organizationId" = 'org_default';
DELETE FROM "settings" WHERE "organizationId" IS NULL;
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey";
ALTER TABLE "settings" DROP COLUMN "id";
ALTER TABLE "settings" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "settings" ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("organizationId");
ALTER TABLE "settings" ADD CONSTRAINT "settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
