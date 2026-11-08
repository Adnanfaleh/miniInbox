-- CreateEnum
CREATE TYPE "Complexity" AS ENUM ('simple', 'complex');

-- CreateEnum
CREATE TYPE "Intent" AS ENUM ('question', 'booking', 'complaint', 'greeting', 'other');

-- CreateEnum
CREATE TYPE "ReplyStatus" AS ENUM ('PENDING', 'REPLIED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "complexity" "Complexity",
ADD COLUMN     "intent" "Intent",
ADD COLUMN     "reply_status" "ReplyStatus";

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_reply_status_idx" ON "messages"("tenant_id", "conversation_id", "reply_status");
