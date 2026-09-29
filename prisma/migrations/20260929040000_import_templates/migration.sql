-- CreateTable
CREATE TABLE "import_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sheetName" TEXT,
    "headerRowIndex" INTEGER NOT NULL,
    "columns" JSONB NOT NULL,
    "duplicateMode" TEXT NOT NULL DEFAULT 'sum',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_templates_organizationId_idx" ON "import_templates"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_organizationId_fingerprint_key" ON "import_templates"("organizationId", "fingerprint");

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

