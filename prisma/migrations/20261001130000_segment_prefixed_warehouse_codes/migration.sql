-- 재고 창고 코드를 방식별 머리글자로 다시 매긴다: 일일 재고 연동 DA, DB, DC … / 비정기 실사 PA, PB, PC …
-- 코드는 화면 표시용 식별자라 다른 데이터가 참조하지 않는다. 조직·방식마다 기존 정렬 순서(sortOrder, 만든 순)대로 매기고,
-- 보관된 창고도 코드를 받는다(새 창고가 보관된 창고의 코드를 재사용하지 않도록).
-- 매장 품목 가상 창고(kind = STORE, 코드 STORE)는 그대로 둔다.

-- 1) 새 코드와 겹치지 않도록 먼저 임시 코드로 비운다.
UPDATE "warehouses" SET "code" = '__' || "id" WHERE "kind" = 'STOCK';

-- 2) 조직·방식별 순번 → 머리글자 + 엑셀 열 이름(A…Z, AA…ZZ).
WITH ranked AS (
  SELECT "id", "segment",
         ROW_NUMBER() OVER (PARTITION BY "organizationId", "segment" ORDER BY "sortOrder", "createdAt", "id") AS n
  FROM "warehouses"
  WHERE "kind" = 'STOCK'
)
UPDATE "warehouses" w
SET "code" = (CASE WHEN r."segment" = 'PERIODIC_COUNT' THEN 'P' ELSE 'D' END)
          || (CASE WHEN r.n <= 26 THEN chr((64 + r.n)::int) ELSE chr((64 + (r.n - 1) / 26)::int) || chr((65 + (r.n - 1) % 26)::int) END)
FROM ranked r
WHERE w."id" = r."id";
