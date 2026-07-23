import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the partner_ui_layout_configuration table (#338 — partner-ui
 * personalization / LayoutComposer persistence).
 *
 * Hand-written (Claude-owned) create migration. Mirrors what DML would
 * generate for the model: jsonb `configuration`/`metadata`, the compound
 * unique index over (partner_id, zone, is_default) as a partial index
 * (WHERE deleted_at IS NULL) so soft-deleted rows don't collide, a lookup
 * index on partner_id, plus the standard deleted_at index.
 */
export class Migration20260715120100 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_ui_layout_configuration" ("id" text not null, "partner_id" text not null, "zone" text not null, "is_default" boolean not null default false, "configuration" jsonb not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_ui_layout_configuration_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_ui_layout_configuration_partner_zone_scope_unique" ON "partner_ui_layout_configuration" ("partner_id", "zone", "is_default") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_ui_layout_configuration_partner_id" ON "partner_ui_layout_configuration" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_ui_layout_configuration_deleted_at" ON "partner_ui_layout_configuration" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_ui_layout_configuration" cascade;`);
  }

}
