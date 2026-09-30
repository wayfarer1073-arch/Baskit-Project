-- AlterTable
ALTER TABLE "event_schedules" ADD COLUMN     "managed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "schedule_store_items" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "storeItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_store_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_store_items_storeItemId_idx" ON "schedule_store_items"("storeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_store_items_scheduleId_storeItemId_key" ON "schedule_store_items"("scheduleId", "storeItemId");

-- AddForeignKey
ALTER TABLE "schedule_store_items" ADD CONSTRAINT "schedule_store_items_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "event_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_store_items" ADD CONSTRAINT "schedule_store_items_storeItemId_fkey" FOREIGN KEY ("storeItemId") REFERENCES "store_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

