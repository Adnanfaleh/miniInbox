-- Row-level security and grants (D-016). Hand-written: Prisma can't express RLS.
-- Based on .claude/skills/multi-tenant-isolation/assets/rls-policy-template.sql.
--
-- Roles:
--   owner (POSTGRES_USER, superuser): runs migrations and the seed. Bypasses RLS.
--   app_user (docker/postgres/init/01-app-role.sh): used by the API and worker. NOBYPASSRLS, not the owner,
--     DML only (no TRUNCATE, no DDL). Every policy below applies to it.
--
-- Tenant context: the app sets it per transaction with SELECT set_config('app.tenant_id', $1, true).
-- One deviation from the template: NULLIF(..., '') before the ::uuid cast. After a transaction-local
-- set_config, a pooled connection reads the setting back as '' (not NULL) in later transactions, and a bare
-- ''::uuid raises an error. With NULLIF, a missing context matches no rows: it fails closed, without errors.

-- Schema and global table
GRANT USAGE ON SCHEMA public TO app_user;
-- tenants is global (the tenancy root, listed in .tenant-isolation.json). Read-only for the app:
-- the tenant-header guard verifies that a tenant exists. Tenants are created by the seed only.
GRANT SELECT ON TABLE "tenants" TO app_user;

-- Tenant tables: DML only
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "persona_configs",
  "knowledge_entries",
  "customers",
  "conversations",
  "messages",
  "conversation_events"
TO app_user;

-- persona_configs
ALTER TABLE "persona_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "persona_configs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "persona_configs_tenant_isolation" ON "persona_configs"
  AS PERMISSIVE
  FOR ALL
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- knowledge_entries
ALTER TABLE "knowledge_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_entries_tenant_isolation" ON "knowledge_entries"
  AS PERMISSIVE
  FOR ALL
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- customers
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customers_tenant_isolation" ON "customers"
  AS PERMISSIVE
  FOR ALL
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- conversations
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "conversations_tenant_isolation" ON "conversations"
  AS PERMISSIVE
  FOR ALL
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- messages
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "messages_tenant_isolation" ON "messages"
  AS PERMISSIVE
  FOR ALL
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- conversation_events
ALTER TABLE "conversation_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "conversation_events_tenant_isolation" ON "conversation_events"
  AS PERMISSIVE
  FOR ALL
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
