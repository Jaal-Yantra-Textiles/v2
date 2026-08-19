import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the assistant_context_cache table.
 *
 * One row per (principal_id, surface, domain) — upserted after each assistant
 * turn that touches that domain, so the most recent context for each domain is
 * always one row away. A unique index on (principal_id, surface, domain)
 * enforces the single-row invariant; a secondary index on
 * (principal_id, surface) makes the "read all domains for this user" lookup
 * cheap.
 *
 * Distinct class name + timestamp to avoid the Medusa migration-name-collision
 * hazard.
 */
export class Migration20260818120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "assistant_context_cache" ("id" text not null, "principal_id" text not null, "surface" text not null, "domain" text not null, "entity_ids" jsonb not null default '[]', "summary" text not null, "conversation_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "assistant_context_cache_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_assistant_context_cache_principal_surface_domain" ON "assistant_context_cache" ("principal_id", "surface", "domain") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_assistant_context_cache_principal_surface" ON "assistant_context_cache" ("principal_id", "surface") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_assistant_context_cache_deleted_at" ON "assistant_context_cache" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "assistant_context_cache" cascade;`);
  }

}
