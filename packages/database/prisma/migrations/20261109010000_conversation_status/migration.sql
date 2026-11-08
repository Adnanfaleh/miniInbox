-- Conversation lifecycle (D-047): OPEN / CLOSED. Staff close a conversation; the customer's next message reopens
-- the same conversation in AI mode. Existing conversations start OPEN. RLS on "conversations" already covers the
-- new columns (row-level policy, no column grants needed).

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'CLOSED';
ALTER TYPE "EventType" ADD VALUE 'REOPENED';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "status_changed_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_created_at_idx" ON "conversations"("tenant_id", "status", "created_at");
