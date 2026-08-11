import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260811152246 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "location_ownership" drop constraint if exists "location_ownership_stock_location_id_unique";`);
    this.addSql(`create table if not exists "location_ownership" ("id" text not null, "stock_location_id" text not null, "is_core" boolean not null default false, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "location_ownership_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_location_ownership_stock_location_id_unique" ON "location_ownership" ("stock_location_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_location_ownership_deleted_at" ON "location_ownership" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "location_ownership" cascade;`);
  }

}
