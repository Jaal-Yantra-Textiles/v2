import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #778 H4 — first-class activity/timeline log for inventory orders, mirroring
 * production_run_activity. Brand-new table, so create-table-if-not-exists is
 * correct here (the create-if-not-exists hazard only applies to ADDING columns
 * to existing tables).
 */
export class Migration20260630170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_order_activity" (
      "id" text not null,
      "inventory_order_id" text not null,
      "activity_type" text check ("activity_type" in ('lifecycle_event', 'reminder_sent', 'note', 'system')) not null,
      "kind" text not null,
      "actor_type" text check ("actor_type" in ('system', 'admin', 'partner', 'scheduled_flow')) not null default 'system',
      "actor_id" text null,
      "partner_id" text null,
      "channel" text check ("channel" in ('whatsapp', 'email', 'in_app')) null,
      "message_id" text null,
      "template_name" text null,
      "recipient" text null,
      "summary" text null,
      "payload" jsonb null,
      "occurred_at" timestamptz not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "inventory_order_activity_pkey" primary key ("id")
    );`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_activity_deleted_at" ON "inventory_order_activity" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_activity_order_id" ON "inventory_order_activity" ("inventory_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_activity_order_occurred" ON "inventory_order_activity" ("inventory_order_id", "occurred_at" DESC) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_activity_partner_id" ON "inventory_order_activity" ("partner_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inventory_order_activity" cascade;`);
  }
}
