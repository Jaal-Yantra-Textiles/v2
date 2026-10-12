import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2322 — profit share on partner runs made with our material.
 *
 * Hand-written: one nullable column on production_runs and two new tables,
 * so down() drops only what this change added.
 */
export class Migration20261012090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "profit_share_percent" real null;`);

    this.addSql(`create table if not exists "production_run_sale" ("id" text not null, "production_run_id" text not null, "partner_id" text null, "quantity" real not null, "unit_price" numeric not null, "currency_code" text not null default 'inr', "sold_at" timestamptz not null, "note" text null, "reported_by" text check ("reported_by" in ('admin', 'partner')) not null default 'admin', "actor_id" text null, "metadata" jsonb null, "raw_unit_price" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "production_run_sale_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_sale_deleted_at" ON "production_run_sale" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_sale_production_run_id" ON "production_run_sale" ("production_run_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "production_run_settlement" ("id" text not null, "production_run_id" text not null, "partner_id" text null, "amount" numeric not null, "currency_code" text not null default 'inr', "method" text check ("method" in ('bank_transfer', 'cash')) not null, "paid_at" timestamptz not null, "reference" text null, "receipt_url" text null, "note" text null, "actor_id" text null, "metadata" jsonb null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "production_run_settlement_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_settlement_deleted_at" ON "production_run_settlement" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_settlement_production_run_id" ON "production_run_settlement" ("production_run_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "production_run_settlement" cascade;`);
    this.addSql(`drop table if exists "production_run_sale" cascade;`);
    this.addSql(`alter table if exists "production_runs" drop column if exists "profit_share_percent";`);
  }

}
