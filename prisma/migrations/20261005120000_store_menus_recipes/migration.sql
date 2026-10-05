-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "storeContentPerUnit" DECIMAL(12,3),
ADD COLUMN     "storeContentUnit" TEXT;

-- CreateTable
CREATE TABLE "store_menus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_recipe_lines" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "store_recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_menu_aliases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "menuId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_menu_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_sales" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_menus_organizationId_name_key" ON "store_menus"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "store_recipe_lines_menuId_skuId_key" ON "store_recipe_lines"("menuId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "store_menu_aliases_organizationId_alias_key" ON "store_menu_aliases"("organizationId", "alias");

-- CreateIndex
CREATE INDEX "menu_sales_organizationId_date_idx" ON "menu_sales"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "menu_sales_menuId_date_key" ON "menu_sales"("menuId", "date");

-- AddForeignKey
ALTER TABLE "store_menus" ADD CONSTRAINT "store_menus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_recipe_lines" ADD CONSTRAINT "store_recipe_lines_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "store_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_recipe_lines" ADD CONSTRAINT "store_recipe_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_menu_aliases" ADD CONSTRAINT "store_menu_aliases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_menu_aliases" ADD CONSTRAINT "store_menu_aliases_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "store_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_sales" ADD CONSTRAINT "menu_sales_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_sales" ADD CONSTRAINT "menu_sales_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "store_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

