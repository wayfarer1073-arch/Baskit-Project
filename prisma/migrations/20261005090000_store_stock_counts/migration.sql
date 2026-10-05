-- CreateTable
CREATE TABLE "store_stock_counts" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "countDate" DATE NOT NULL,
    "fullUnits" DECIMAL(12,2) NOT NULL,
    "openedPercent" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_stock_counts_skuId_countDate_key" ON "store_stock_counts"("skuId", "countDate");

-- AddForeignKey
ALTER TABLE "store_stock_counts" ADD CONSTRAINT "store_stock_counts_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_stock_counts" ADD CONSTRAINT "store_stock_counts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

