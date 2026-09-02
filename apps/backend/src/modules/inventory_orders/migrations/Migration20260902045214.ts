import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260902045214 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_order_charge" ("id" text not null, "type" text check ("type" in ('tax', 'shipping', 'discount', 'adjustment')) not null, "amount" numeric not null, "note" text null, "metadata" jsonb null, "inventory_orders_id" text not null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_order_charge_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_charge_inventory_orders_id" ON "inventory_order_charge" ("inventory_orders_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_charge_deleted_at" ON "inventory_order_charge" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "inventory_order_charge" add constraint "inventory_order_charge_inventory_orders_id_foreign" foreign key ("inventory_orders_id") references "inventory_orders" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inventory_order_charge" cascade;`);
  }

}
