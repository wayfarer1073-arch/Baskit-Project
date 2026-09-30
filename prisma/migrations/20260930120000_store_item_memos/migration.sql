-- CreateTable
CREATE TABLE "store_item_memos" (
    "id" TEXT NOT NULL,
    "storeItemId" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "note" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdById" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_item_memos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_item_memos_storeItemId_startDate_idx" ON "store_item_memos"("storeItemId", "startDate");

-- AddForeignKey
ALTER TABLE "store_item_memos" ADD CONSTRAINT "store_item_memos_storeItemId_fkey" FOREIGN KEY ("storeItemId") REFERENCES "store_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_item_memos" ADD CONSTRAINT "store_item_memos_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

