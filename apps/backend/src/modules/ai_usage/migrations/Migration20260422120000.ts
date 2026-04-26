import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260422120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "ai_usage_event" (` +
        `"id" text not null, ` +
        `"partner_id" text not null, ` +
        `"operation" text not null, ` +
        `"metadata" jsonb null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "ai_usage_event_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_partner_id" ON "ai_usage_event" ("partner_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_operation" ON "ai_usage_event" ("operation") WHERE deleted_at IS NULL;`
    )
    // Fast "count for this partner+operation since X" lookup.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_lookup" ON "ai_usage_event" ("partner_id", "operation", "created_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_deleted_at" ON "ai_usage_event" ("deleted_at") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_usage_event" cascade;`)
  }
}
