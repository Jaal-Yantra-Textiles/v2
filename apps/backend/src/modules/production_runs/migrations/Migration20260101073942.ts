import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260101073942 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "production_runs" ("id" text not null, "status" text check ("status" in ('draft', 'pending_review', 'approved', 'sent_to_partner', 'in_progress', 'completed', 'cancelled')) not null default 'pending_review', "quantity" real not null default 1, "design_id" text not null, "partner_id" text null, "product_id" text null, "variant_id" text null, "order_id" text null, "order_line_item_id" text null, "snapshot" jsonb not null, "captured_at" timestamptz not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "production_runs_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_runs_deleted_at" ON "production_runs" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "production_runs" cascade;`);
  }

}
