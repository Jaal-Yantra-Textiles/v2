import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260425010001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "production_run_activity" (
      "id" text not null,
      "production_run_id" text not null,
      "activity_type" text check ("activity_type" in ('reminder_sent', 'lifecycle_event', 'note', 'system')) not null,
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
      constraint "production_run_activity_pkey" primary key ("id")
    );`)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_activity_deleted_at" ON "production_run_activity" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_activity_run_id" ON "production_run_activity" ("production_run_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_activity_run_occurred" ON "production_run_activity" ("production_run_id", "occurred_at" DESC) WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_activity_partner_id" ON "production_run_activity" ("partner_id") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "production_run_activity" cascade;`)
  }
}
