import { Migration } from "@mikro-orm/migrations";

/**
 * #2289 — `inventory_dispatch`: a supplier's dispatch of an inventory order
 * line, kept apart from the `line_fulfillment` receipt ledger.
 *
 * HAND-WRITTEN, not `db:generate`d — this module carries no MikroORM snapshot,
 * so the generator would rebuild every model and its `down()` would drop the
 * live tables. Same reasoning as Migration20260918120000.
 */
export class Migration20261008090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_dispatch" (
      "id" text not null,
      "inventory_order_id" text not null,
      "inventory_order_line_id" text not null,
      "quantity" real not null,
      "partner_id" text null,
      "dispatched_at" timestamptz not null,
      "delivery_date" text null,
      "tracking_number" text null,
      "notes" text null,
      "transaction_id" text null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "inventory_dispatch_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_dispatch_order_id" ON "inventory_dispatch" ("inventory_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_dispatch_line_id" ON "inventory_dispatch" ("inventory_order_line_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_dispatch_deleted_at" ON "inventory_dispatch" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inventory_dispatch" cascade;`);
  }

}
