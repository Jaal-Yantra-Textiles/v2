import { Migration } from '@mikro-orm/migrations';

export class Migration20250416111440 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_orders" ("id" text not null, "quantity" integer not null, "total_price" numeric not null, "status" text check ("status" in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled')) not null default 'Pending', "expected_delivery_date" timestamptz not null, "order_date" timestamptz not null, "metadata" jsonb null, "shipping_address" jsonb null, "raw_total_price" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_orders_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_orders_deleted_at" ON "inventory_orders" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "inventory_order_line" ("id" text not null, "quantity" integer not null, "price" numeric not null, "metadata" jsonb null, "inventory_orders_id" text not null, "raw_price" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_order_line_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_line_inventory_orders_id" ON "inventory_order_line" (inventory_orders_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_line_deleted_at" ON "inventory_order_line" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "inventory_order_line" add constraint "inventory_order_line_inventory_orders_id_foreign" foreign key ("inventory_orders_id") references "inventory_orders" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" drop constraint if exists "inventory_order_line_inventory_orders_id_foreign";`);

    this.addSql(`drop table if exists "inventory_orders" cascade;`);

    this.addSql(`drop table if exists "inventory_order_line" cascade;`);
  }

}
