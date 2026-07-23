import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Extend ai_usage_event into the cross-surface MCP observability ledger (#844).
 *
 * - `partner_id` becomes nullable — admin/store MCP calls have no partner actor.
 * - Add `surface` / `actor_id` / `actor_type` to identify the MCP surface and
 *   the actor behind each tool dispatch. All nullable + additive, so legacy
 *   partner-image quota rows are untouched.
 */
export class Migration20260720190000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "ai_usage_event" alter column "partner_id" drop not null;`
    )
    this.addSql(
      `alter table if exists "ai_usage_event" add column if not exists "surface" text null;`
    )
    this.addSql(
      `alter table if exists "ai_usage_event" add column if not exists "actor_id" text null;`
    )
    this.addSql(
      `alter table if exists "ai_usage_event" add column if not exists "actor_type" text null;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_surface" ON "ai_usage_event" ("surface") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_actor_id" ON "ai_usage_event" ("actor_id") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `DROP INDEX IF EXISTS "IDX_ai_usage_event_actor_id";`
    )
    this.addSql(
      `DROP INDEX IF EXISTS "IDX_ai_usage_event_surface";`
    )
    this.addSql(
      `alter table if exists "ai_usage_event" drop column if exists "actor_type";`
    )
    this.addSql(
      `alter table if exists "ai_usage_event" drop column if exists "actor_id";`
    )
    this.addSql(
      `alter table if exists "ai_usage_event" drop column if exists "surface";`
    )
    // Note: partner_id is left nullable on down — re-adding NOT NULL could fail
    // against ledger rows written while this migration was live.
  }
}
