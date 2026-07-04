import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// #888 — carrier tracking webhook feeds live shipment statuses, so the
// inventory_shipment status set grows beyond creation-time values. Hand-written
// ALTER (never edit the existing create-table migration — it would silently
// skip on DBs where the table already exists): drop and re-add the check
// constraint with the post-pickup lifecycle values.
export class Migration20260704160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_shipment" drop constraint if exists "inventory_shipment_status_check";`);
    this.addSql(`alter table if exists "inventory_shipment" add constraint "inventory_shipment_status_check" check ("status" in ('created', 'pickup_scheduled', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'rto', 'cancelled'));`);
  }

  override async down(): Promise<void> {
    // Collapse webhook-fed values back to the closest creation-time status so
    // the narrower constraint can be re-applied.
    this.addSql(`update "inventory_shipment" set "status" = 'pickup_scheduled' where "status" not in ('created', 'pickup_scheduled', 'cancelled');`);
    this.addSql(`alter table if exists "inventory_shipment" drop constraint if exists "inventory_shipment_status_check";`);
    this.addSql(`alter table if exists "inventory_shipment" add constraint "inventory_shipment_status_check" check ("status" in ('created', 'pickup_scheduled', 'cancelled'));`);
  }

}
