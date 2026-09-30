-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "disabledSegments" "BusinessSegment"[] DEFAULT ARRAY[]::"BusinessSegment"[];

