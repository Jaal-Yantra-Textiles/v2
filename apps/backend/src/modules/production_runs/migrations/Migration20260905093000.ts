import { Migration } from "@mikro-orm/migrations";

/**
 * #1805 — the output review on a completed run.
 *
 * A completed run's goods are reviewed before anything is listed for sale:
 * approve creates the catalogue product, reject creates nothing. Until now
 * there was no record of either, so "rejected" was indistinguishable from
 * "nobody has looked yet" and a rejected run came back in the queue forever.
 *
 * 🔴 A separate AXIS from `status`. A rejected run stays `completed` — it WAS
 * completed, the partner is still owed for `produced_quantity`, and billing
 * keys on that status. See the model for the full argument.
 *
 * All nullable with no default, so every existing run reads as UNREVIEWED,
 * which is what they are.
 *
 * ⚠️ The check constraint is written the way MikroORM writes one for a DML
 * enum (`<table>_<column>_check`). Leaving it out would let the column drift
 * from the model, and a value the model has never heard of is how an enum
 * column fails an INSERT with a bare 500 (#1439's `quoted_weight_source`).
 */
export class Migration20260905093000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      alter table if exists "production_runs"
        add column if not exists "approval_decision" text null,
        add column if not exists "approval_decided_at" timestamptz null,
        add column if not exists "approval_decided_by" text null,
        add column if not exists "approval_reason" text null,
        add column if not exists "approved_product_id" text null,
        add column if not exists "approved_variant_id" text null;
    `);

    this.addSql(`
      alter table if exists "production_runs"
        drop constraint if exists "production_runs_approval_decision_check";
    `);
    this.addSql(`
      alter table if exists "production_runs"
        add constraint "production_runs_approval_decision_check"
        check("approval_decision" in ('approved', 'rejected'));
    `);

    /**
     * The review queue is "completed runs nobody has decided on yet", and it is
     * the only query these columns exist to serve. Partial on the undecided
     * rows, which is the half that stays small as decided runs accumulate.
     */
    this.addSql(`
      create index if not exists "IDX_production_runs_awaiting_output_review"
        on "production_runs" ("status")
        where "approval_decision" is null and "deleted_at" is null;
    `);
  }

  /**
   * Reversible: without these columns every run reads as unreviewed again,
   * which is the pre-migration behaviour. It DOES discard the decisions
   * themselves — acceptable because nothing downstream depends on them yet;
   * the products an approval created are ordinary catalogue rows and survive.
   */
  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_production_runs_awaiting_output_review";`);
    this.addSql(`
      alter table if exists "production_runs"
        drop constraint if exists "production_runs_approval_decision_check";
    `);
    this.addSql(`
      alter table if exists "production_runs"
        drop column if exists "approval_decision",
        drop column if exists "approval_decided_at",
        drop column if exists "approval_decided_by",
        drop column if exists "approval_reason",
        drop column if exists "approved_product_id",
        drop column if exists "approved_variant_id";
    `);
  }

}
