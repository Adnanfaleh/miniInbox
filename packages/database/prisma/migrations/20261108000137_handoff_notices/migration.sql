-- AlterEnum
ALTER TYPE "SenderType" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "persona_configs" ADD COLUMN     "handoff_notices_enabled" BOOLEAN NOT NULL DEFAULT true;
