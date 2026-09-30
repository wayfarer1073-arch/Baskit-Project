-- 매장 품목을 가상 창고(STORE) SKU로 옮긴다. 기존 매장 품목·발주 기록은 참고용 가상 데이터라 지운다.
DELETE FROM "purchase_orders";
-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('STOCK', 'STORE');

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_itemId_fkey";

-- DropForeignKey
ALTER TABLE "schedule_store_items" DROP CONSTRAINT "schedule_store_items_scheduleId_fkey";

-- DropForeignKey
ALTER TABLE "schedule_store_items" DROP CONSTRAINT "schedule_store_items_storeItemId_fkey";

-- DropForeignKey
ALTER TABLE "store_item_memos" DROP CONSTRAINT "store_item_memos_createdById_fkey";

-- DropForeignKey
ALTER TABLE "store_item_memos" DROP CONSTRAINT "store_item_memos_storeItemId_fkey";

-- DropForeignKey
ALTER TABLE "store_items" DROP CONSTRAINT "store_items_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "store_items" DROP CONSTRAINT "store_items_supplierId_fkey";

-- DropIndex
DROP INDEX "purchase_orders_itemId_orderDate_idx";

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "itemId",
ADD COLUMN     "skuId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "kind" "WarehouseKind" NOT NULL DEFAULT 'STOCK';

-- DropTable
DROP TABLE "schedule_store_items";

-- DropTable
DROP TABLE "store_item_memos";

-- DropTable
DROP TABLE "store_items";

-- CreateIndex
CREATE INDEX "purchase_orders_skuId_orderDate_idx" ON "purchase_orders"("skuId", "orderDate");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

