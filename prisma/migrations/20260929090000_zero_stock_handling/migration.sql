-- AlterTable
ALTER TABLE "import_templates" ADD COLUMN     "stockUnit" TEXT,
ADD COLUMN     "zeroStockAsSoldOut" BOOLEAN;

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "removedDate" DATE;

