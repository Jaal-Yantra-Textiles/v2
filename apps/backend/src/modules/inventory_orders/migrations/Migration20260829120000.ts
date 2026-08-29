import { Migration } from "@mikro-orm/migrations";

/**
 * #1617 — `inventory_orders.agreed_total`: what was AGREED with the partner,
 * which is not what the order was priced at.
 *
 * `total_price` is Σ(line quantity × line price). On
 * `inv_order_01K76V5J4KKS3EC71D2R2MNJSP` that is ₹63,375.75, while the figure
 * actually agreed with the partner was ₹35,000 — recorded, until now, only in a
 * submission's `metadata.agreed_total`, which is not a contract.
 *
 * The payout guard sums live claims against this and refuses the excess, so a
 * ₹30,000 tranche no longer locks out the remaining ₹5,000. Null means "nobody
 * recorded an agreed price", and the guard falls back to `total_price` — never
 * invented, because a fabricated ceiling is a licence to overpay.
 *
 * Hand-written idempotent ALTER: the table exists on live DBs. `numeric` with
 * no precision, matching how `total_price` is stored by bigNumber.
 */
export class Migration20260829120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "agreed_total" numeric null;`);
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "raw_agreed_total" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "agreed_total";`);
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "raw_agreed_total";`);
  }

}
