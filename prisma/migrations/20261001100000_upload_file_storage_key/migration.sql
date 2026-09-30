-- AlterTable
ALTER TABLE "upload_files" ADD COLUMN     "storageKey" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

