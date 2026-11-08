-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('CUSTOMER', 'AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('TAKEOVER', 'RETURN_TO_AI', 'DRAFT_DISCARDED', 'AI_REPLY_SENT');

-- CreateEnum
CREATE TYPE "LanguagePreference" AS ENUM ('ar', 'en', 'match_customer');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_configs" (
    "tenant_id" UUID NOT NULL,
    "tone" VARCHAR(500) NOT NULL,
    "language_preference" "LanguagePreference" NOT NULL,
    "reply_type" VARCHAR(50) NOT NULL,
    "reply_max_length" INTEGER NOT NULL,
    "business_instructions" VARCHAR(4000) NOT NULL,
    "out_of_kb_message_en" VARCHAR(1000) NOT NULL,
    "out_of_kb_message_ar" VARCHAR(1000) NOT NULL,
    "out_of_hours_message_en" VARCHAR(1000) NOT NULL,
    "out_of_hours_message_ar" VARCHAR(1000) NOT NULL,
    "working_days" VARCHAR(50) NOT NULL,
    "work_start" TIME(0) NOT NULL,
    "work_end" TIME(0) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "persona_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "knowledge_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "title_en" VARCHAR(200) NOT NULL,
    "title_ar" VARCHAR(200) NOT NULL,
    "content_en" TEXT NOT NULL,
    "content_ar" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "external_ref" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "Mode" NOT NULL DEFAULT 'AI',
    "mode_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_type" "SenderType" NOT NULL,
    "external_id" VARCHAR(200),
    "body" TEXT NOT NULL,
    "in_reply_to_message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "event_type" "EventType" NOT NULL,
    "message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_entries_tenant_id_id_key" ON "knowledge_entries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_external_ref_key" ON "customers"("tenant_id", "external_ref");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_created_at_idx" ON "conversations"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_id_key" ON "conversations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_customer_id_key" ON "conversations"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_created_at_idx" ON "messages"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_id_key" ON "messages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_external_id_key" ON "messages"("tenant_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_in_reply_to_message_id_key" ON "messages"("tenant_id", "in_reply_to_message_id");

-- CreateIndex
CREATE INDEX "conversation_events_tenant_id_conversation_id_created_at_idx" ON "conversation_events"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_events_tenant_id_id_key" ON "conversation_events"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "persona_configs" ADD CONSTRAINT "persona_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_in_reply_to_message_id_fkey" FOREIGN KEY ("tenant_id", "in_reply_to_message_id") REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_id_message_id_fkey" FOREIGN KEY ("tenant_id", "message_id") REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
