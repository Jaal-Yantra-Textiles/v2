import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Give a payment submission line item a quantity and a unit rate (#1554).
 *
 * The amount on a design-sourced line was a PER-UNIT figure billed once:
 * `design.estimated_cost` / `production_cost` are per finished unit (see
 * `workflows/designs/estimate-design-cost.ts`, which divides a run total back
 * to per-unit for exactly that reason), and `create-payment-submission` used
 * that number as the whole line amount. A design costed at 850/unit and
 * produced nine times billed 850.
 *
 * `amount` stays the authoritative total and is untouched here — existing rows
 * keep whatever they were paid. `quantity` defaults to 1, which is the honest
 * reading of a legacy row: it says "this line billed one unit's worth", which
 * is precisely what went wrong and precisely what the backfill audit looks for.
 * `unit_amount` is left NULL on old rows rather than derived from
 * `amount / quantity` — a derived rate would assert a breakdown nobody recorded.
 *
 * ⚠️ The definition alone only covers a database built from scratch; the
 * generator leaves an existing column alone. Hence the explicit DDL.
 */
export class Migration20260826140000 extends Migration {

  override async up(): Promise<void> {
    // `real`, matching model.float() elsewhere in the codebase (goods_transfer
    // .quantity). A piece count is an integer in practice and well inside the
    // exactly-representable range.
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "quantity" real not null default 1;`);

    // bigNumber → a numeric column plus its raw_ jsonb sidecar. Both nullable:
    // a line whose total was typed directly has no meaningful per-unit rate,
    // and inventing one would be a claim about how a payment was arrived at.
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "unit_amount" numeric null;`);
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "raw_unit_amount" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "raw_unit_amount";`);
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "unit_amount";`);
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "quantity";`);
  }

}
