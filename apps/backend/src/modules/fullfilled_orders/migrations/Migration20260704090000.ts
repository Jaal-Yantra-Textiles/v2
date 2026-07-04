import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Inventory-order carrier shipments become first-class rows (#772 follow-up):
// previously only `inventory_order.metadata.shipment` held the AWB/label refs,
// so multiple shipments overwrote each other and the resolved pickup warehouse
// was never recorded. New table — a create is safe here (the hazard is only
// editing an EXISTING create-table migration).
export class Migration20260704090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_shipment" (
      "id" text not null,
      "carrier" text not null,
      "awb" text null,
      "tracking_number" text null,
      "tracking_url" text null,
      "label_url" text null,
      "pickup_location_name" text null,
      "pickup_stock_location_id" text null,
      "pickup_scheduled_date" text null,
      "status" text check ("status" in ('created', 'pickup_scheduled', 'cancelled')) not null default 'created',
      "weight_grams" real null,
      "dimensions_cm" jsonb null,
      "provider_refs" jsonb null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "inventory_shipment_pkey" primary key ("id")
    );`);
    this.addSql(`create index if not exists "IDX_inventory_shipment_deleted_at" on "inventory_shipment" ("deleted_at") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inventory_shipment" cascade;`);
  }

}
