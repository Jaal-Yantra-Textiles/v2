import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260526052102 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "fx_price_meta" ("id" text not null, "base_currency" text not null, "base_amount" numeric not null, "fx_rate" numeric not null, "source_price_id" text null, "raw_base_amount" jsonb not null, "raw_fx_rate" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fx_price_meta_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fx_price_meta_deleted_at" ON "fx_price_meta" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fx_price_meta_source_price_id" ON "fx_price_meta" ("source_price_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "fx_price_meta" cascade;`);
  }

}
