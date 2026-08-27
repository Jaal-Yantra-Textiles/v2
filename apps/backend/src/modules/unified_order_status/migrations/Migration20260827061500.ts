import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1574 — `partner_status` gains "cancelled".
 *
 * The column is `text` with a check constraint listing the allowed values, so
 * a new enum member is a constraint swap rather than a type change. Without
 * this the model would accept "cancelled" and the INSERT would fail at the
 * database, which is exactly the shape that turns a status fix into a silent
 * write failure behind a swallow-and-warn boundary.
 */
export class Migration20260827061500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "unified_order_status" drop constraint if exists "unified_order_status_partner_status_check";`);
    this.addSql(`alter table if exists "unified_order_status" add constraint "unified_order_status_partner_status_check" check ("partner_status" in ('assigned', 'accepted', 'in_progress', 'finished', 'partial', 'completed', 'declined', 'cancelled'));`);
  }

  override async down(): Promise<void> {
    // Rows already carrying the new value would violate the narrower
    // constraint, so retire them to the nearest older meaning first.
    this.addSql(`update "unified_order_status" set "partner_status" = 'declined' where "partner_status" = 'cancelled';`);
    this.addSql(`alter table if exists "unified_order_status" drop constraint if exists "unified_order_status_partner_status_check";`);
    this.addSql(`alter table if exists "unified_order_status" add constraint "unified_order_status_partner_status_check" check ("partner_status" in ('assigned', 'accepted', 'in_progress', 'finished', 'partial', 'completed', 'declined'));`);
  }

}
