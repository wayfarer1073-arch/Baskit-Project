-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('FILE', 'MANUAL');

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "unitCostSource" "CostSource",
ADD COLUMN     "unitCostUpdatedAt" TIMESTAMP(3);


-- 이미 파일에서 원가를 받은 품목은 파일 출처로 표시한다.
UPDATE "skus" SET "unitCostSource" = 'FILE' WHERE "currentUnitCost" > 0;
