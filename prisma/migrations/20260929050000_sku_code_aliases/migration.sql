-- CreateTable
CREATE TABLE "sku_code_aliases" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_code_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sku_code_aliases_skuId_idx" ON "sku_code_aliases"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "sku_code_aliases_warehouseId_externalCode_key" ON "sku_code_aliases"("warehouseId", "externalCode");

-- AddForeignKey
ALTER TABLE "sku_code_aliases" ADD CONSTRAINT "sku_code_aliases_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_code_aliases" ADD CONSTRAINT "sku_code_aliases_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

