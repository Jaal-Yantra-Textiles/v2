import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260924084725 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "work_order" ("id" text not null, "display_id" serial, "kind" text check ("kind" in ('design', 'inventory')) not null, "collation" text check ("collation" in ('collated', 'per_run')) not null default 'per_run', "status" text check ("status" in ('pending', 'completed', 'draft', 'archived', 'canceled', 'requires_action')) not null default 'pending', "partner_status" text check ("partner_status" in ('assigned', 'accepted', 'in_progress', 'finished', 'partial', 'completed', 'declined', 'cancelled')) null, "partner_id" text null, "currency_code" text not null, "inventory_order_id" text null, "source_order_id" text null, "canceled_at" timestamptz null, "superseded_by_run_ids" text[] null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "work_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_deleted_at" ON "work_order" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_partner_id" ON "work_order" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_kind" ON "work_order" ("kind") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_inventory_order_id" ON "work_order" ("inventory_order_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "work_order_item" ("id" text not null, "title" text not null, "subtitle" text null, "thumbnail" text null, "quantity" numeric not null, "unit_price" numeric not null, "design_id" text null, "production_run_id" text null, "inventory_order_line_id" text null, "work_order_id" text not null, "raw_quantity" jsonb not null, "raw_unit_price" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "work_order_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_item_work_order_id" ON "work_order_item" ("work_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_item_deleted_at" ON "work_order_item" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_item_production_run_id" ON "work_order_item" ("production_run_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_item_design_id" ON "work_order_item" ("design_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_order_item_inventory_order_line_id" ON "work_order_item" ("inventory_order_line_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "work_order_item" add constraint "work_order_item_work_order_id_foreign" foreign key ("work_order_id") references "work_order" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "work_order_item" drop constraint if exists "work_order_item_work_order_id_foreign";`);

    this.addSql(`drop table if exists "work_order" cascade;`);

    this.addSql(`drop table if exists "work_order_item" cascade;`);
  }

}
