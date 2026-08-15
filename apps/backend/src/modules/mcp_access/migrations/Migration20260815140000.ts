import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the mcp_access_scope table (#1306 Track C — per-token MCP scopes).
 *
 * Hand-written create migration, mirroring what DML would generate for the
 * model: the compound unique index over (principal_type, principal_id) as a
 * partial index (WHERE deleted_at IS NULL) so a soft-deleted scope doesn't
 * block re-scoping the same credential, plus the standard deleted_at index.
 *
 * Idempotent (`if not exists` throughout) — a re-run is a no-op rather than a
 * failure that the migrate job would report as success (#1208).
 */
export class Migration20260815140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "mcp_access_scope" ("id" text not null, "principal_type" text not null, "principal_id" text not null, "level" text not null default 'read', "label" text null, "note" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mcp_access_scope_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mcp_access_scope_principal_unique" ON "mcp_access_scope" ("principal_type", "principal_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mcp_access_scope_deleted_at" ON "mcp_access_scope" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "mcp_access_scope" cascade;`);
  }

}
