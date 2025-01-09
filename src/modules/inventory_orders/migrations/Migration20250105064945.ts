import { Migration } from '@mikro-orm/migrations';

export class Migration20250105064945 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "inventory_orders" ("id" text not null, "quantity" integer not null, "total_price" numeric not null, "status" text check ("status" in (\'Pending\', \'Processing\', \'Shipped\', \'Delivered\', \'Cancelled\')) not null default \'Pending\', "expected_delivery_date" timestamptz not null, "order_date" timestamptz not null, "metadata" jsonb null, "raw_total_price" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_orders_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_inventory_orders_deleted_at" ON "inventory_orders" (deleted_at) WHERE deleted_at IS NULL;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "inventory_orders" cascade;');
  }

}
