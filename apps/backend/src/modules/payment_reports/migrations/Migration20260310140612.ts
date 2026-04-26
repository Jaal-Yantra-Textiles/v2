import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260310140612 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_report" ("id" text not null, "period_start" timestamptz not null, "period_end" timestamptz not null, "entity_type" text check ("entity_type" in ('partner', 'person', 'all')) not null, "entity_id" text not null, "total_amount" numeric not null, "payment_count" integer not null, "by_status" jsonb not null, "by_type" jsonb not null, "generated_at" timestamptz not null, "filters" jsonb not null, "metadata" jsonb not null, "raw_total_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_report_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_report_deleted_at" ON "payment_report" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_report" cascade;`);
  }

}
