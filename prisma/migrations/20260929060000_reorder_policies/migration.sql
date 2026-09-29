-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "reorderLeadTimeDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reorderSafetyDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reorderTargetDays" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "reorderLeadTimeDays" INTEGER,
ADD COLUMN     "reorderMinQty" INTEGER,
ADD COLUMN     "reorderMultiple" INTEGER,
ADD COLUMN     "reorderSafetyDays" INTEGER,
ADD COLUMN     "reorderTargetDays" INTEGER,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "minOrderQty" INTEGER,
ADD COLUMN     "orderMultiple" INTEGER,
ADD COLUMN     "safetyDays" INTEGER,
ADD COLUMN     "targetDays" INTEGER;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

