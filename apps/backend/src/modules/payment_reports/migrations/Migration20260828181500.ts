import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Record WHERE a reconciled payout came from.
 *
 * `payment_reconciliation.reference_type` has offered `inventory_order` since
 * the model was written, but the only writer hardcodes `"payment_submission"`.
 * All four rows on prod say `payment_submission`; none has ever said anything
 * else, so a distinction that was designed has never once been expressed — and
 * a payout for an inventory order is indistinguishable from one for design work.
 *
 * 🔴 New columns rather than finally "using the enum properly". `reference_*`
 * answers "what record is being reconciled" and must keep pointing at the
 * submission; `source_*` answers "where did the money come from". Folding both
 * into `reference_type` would leave one column meaning different things on
 * different rows — the #1559 defect, where `quantity` was a rate or a total
 * depending on a sibling column, and a report-only job consequently told
 * operators to corrupt data that was already correct.
 *
 * Nullable and un-backfilled on purpose: the four existing rows have an
 * unknowable source (their submissions predate `source_type` on items), and
 * inventing one would be worse than admitting it. Readers must treat null as
 * "not recorded", never as a default.
 */
export class Migration20260828181500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payment_reconciliation" add column if not exists "source_type" text null;`);
    this.addSql(`alter table if exists "payment_reconciliation" add column if not exists "source_id" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_reconciliation" drop column if exists "source_type";`);
    this.addSql(`alter table if exists "payment_reconciliation" drop column if exists "source_id";`);
  }

}
