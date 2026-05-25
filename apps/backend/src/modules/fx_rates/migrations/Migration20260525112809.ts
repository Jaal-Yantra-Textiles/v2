import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260525112809 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "fx_rate" drop constraint if exists "fx_rate_pair_unique";`);
    this.addSql(`create table if not exists "fx_rate" ("id" text not null, "base_currency" text not null, "quote_currency" text not null, "rate" numeric not null, "fetched_at" timestamptz not null, "source" text not null, "metadata" jsonb null, "raw_rate" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fx_rate_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fx_rate_deleted_at" ON "fx_rate" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_fx_rate_pair_unique" ON "fx_rate" ("base_currency", "quote_currency") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "fx_rate" cascade;`);
  }

}
