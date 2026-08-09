import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #891 — `goods_transfer`: post-production movement of run output between stock
 * locations.
 *
 * TRIMMED BY HAND. `db:generate` also re-emitted `inventory_shipment` (the
 * module carries no MikroORM snapshot, so the generator rebuilds every model it
 * sees) — harmless on the way up thanks to `if not exists`, but its `down()`
 * would have dropped the live shipments table on a rollback that only ever
 * intended to remove the new one. Only the goods_transfer statements are kept.
 */
export class Migration20260808165525 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "goods_transfer" ("id" text not null, "production_run_id" text not null, "design_id" text null, "quantity" real not null default 1, "from_location_id" text not null, "to_location_id" text null, "reason" text check ("reason" in ('finishing', 'qc', 'packaging', 'stock', 'customer', 'other')) not null default 'stock', "status" text check ("status" in ('draft', 'in_transit', 'delivered', 'cancelled')) not null default 'draft', "shipment_id" text null, "shipped_at" timestamptz null, "received_at" timestamptz null, "received_quantity" real null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "goods_transfer_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_goods_transfer_deleted_at" ON "goods_transfer" ("deleted_at") WHERE deleted_at IS NULL;`);
    // The two lookups every consumer makes: a run's hops, and routing an
    // inbound carrier tracking push back to the transfer that booked it.
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_goods_transfer_production_run_id" ON "goods_transfer" ("production_run_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_goods_transfer_shipment_id" ON "goods_transfer" ("shipment_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "goods_transfer" cascade;`);
  }

}
