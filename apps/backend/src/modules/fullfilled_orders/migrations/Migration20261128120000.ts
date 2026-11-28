import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Manual-carrier bookings (India Post): a partner's request waits as
// `booking_pending` until staff book it and fill in the AWB. Hand-written
// ALTER, same as Migration20260704160000: drop and re-add the check
// constraint with the new value. Purely additive; no rows change.
export class Migration20261128120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_shipment" drop constraint if exists "inventory_shipment_status_check";`);
    this.addSql(`alter table if exists "inventory_shipment" add constraint "inventory_shipment_status_check" check ("status" in ('booking_pending', 'created', 'pickup_scheduled', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'rto', 'cancelled'));`);
  }

  override async down(): Promise<void> {
    // A pending request has no AWB; cancelled is the honest fallback.
    this.addSql(`update "inventory_shipment" set "status" = 'cancelled' where "status" = 'booking_pending';`);
    this.addSql(`alter table if exists "inventory_shipment" drop constraint if exists "inventory_shipment_status_check";`);
    this.addSql(`alter table if exists "inventory_shipment" add constraint "inventory_shipment_status_check" check ("status" in ('created', 'pickup_scheduled', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'rto', 'cancelled'));`);
  }

}
