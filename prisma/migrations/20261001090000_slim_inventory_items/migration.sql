-- 재고 행(inventory_items)을 숫자만 남긴 좁은 표로 다시 만든다.
-- 상품명·옵션·바코드·위치·파일의 위험/경고수량은 바뀐 날만 sku_attribute_versions에 남긴다.
-- 칸을 DROP만 하면 기존 행 크기가 그대로 남으므로, 새 표로 옮겨 담아 실제 공간을 줄인다.

-- 1) 상품 속성 변경 이력
CREATE TABLE "sku_attribute_versions" (
    "skuId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "productName" TEXT NOT NULL,
    "option" TEXT,
    "barcode" TEXT,
    "location" TEXT,
    "warningQty" INTEGER NOT NULL DEFAULT 0,
    "dangerQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sku_attribute_versions_pkey" PRIMARY KEY ("skuId","effectiveDate")
);

ALTER TABLE "sku_attribute_versions" ADD CONSTRAINT "sku_attribute_versions_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 업로드에서 값이 바뀐 날만 옮겨 담는다(유효한 버전만, 날짜순으로 직전 관측과 비교).
INSERT INTO "sku_attribute_versions" ("skuId", "effectiveDate", "productName", "option", "barcode", "location", "warningQty", "dangerQty")
SELECT "skuId", d, "productName", "option", "barcode", "location", "warningQty", "dangerQty"
FROM (
  SELECT i."skuId", s."snapshotDate" AS d, i."productName", i."option", i."barcode", i."location", i."warningQty", i."dangerQty",
         ROW(i."productName", i."option", i."barcode", i."location", i."warningQty", i."dangerQty") AS cur,
         LAG(ROW(i."productName", i."option", i."barcode", i."location", i."warningQty", i."dangerQty")) OVER (PARTITION BY i."skuId" ORDER BY s."snapshotDate") AS prev
  FROM "inventory_items" i
  JOIN "inventory_snapshots" s ON s.id = i."snapshotId"
  WHERE s.status = 'ACTIVE'
) t
WHERE prev IS DISTINCT FROM cur
ON CONFLICT DO NOTHING;

-- 2) 좁은 재고 행 표. 덮어쓴(REPLACED) 버전의 행은 어디서도 읽지 않으므로 옮기지 않는다.
CREATE TABLE "inventory_items_new" (
    "snapshotId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unitCostProvided" BOOLEAN NOT NULL DEFAULT true,
    "totalCost" DECIMAL(24,2),
    "normalStock" INTEGER NOT NULL DEFAULT 0,
    "defectiveStock" INTEGER NOT NULL DEFAULT 0,
    "incomingStock" INTEGER NOT NULL DEFAULT 0,
    "extra" JSONB
);

INSERT INTO "inventory_items_new" ("snapshotId", "skuId", "unitCost", "unitCostProvided", "totalCost", "normalStock", "defectiveStock", "incomingStock", "extra")
SELECT i."snapshotId", i."skuId", i."unitCost", i."unitCostProvided", i."totalCost", i."normalStock", i."defectiveStock", i."incomingStock", i."extra"
FROM "inventory_items" i
JOIN "inventory_snapshots" s ON s.id = i."snapshotId"
WHERE s.status = 'ACTIVE';

DROP TABLE "inventory_items";
ALTER TABLE "inventory_items_new" RENAME TO "inventory_items";

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("snapshotId", "skuId");
CREATE INDEX "inventory_items_skuId_idx" ON "inventory_items"("skuId");
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "inventory_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
