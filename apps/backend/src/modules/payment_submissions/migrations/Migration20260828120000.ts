import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Payment submissions become the central payout registry (#1612): a line can
 * now be sourced from a production RUN or an INVENTORY ORDER, not only a
 * design or a task.
 *
 * ## Why the existing two values could not cover it
 *
 * **Runs.** The seven runs behind retail order #79 were minted from
 * `order.fulfillment_created` and carry `design_id: null`. They are not
 * design-backed and never will be, so no `design` line can express them —
 * which is why `payable-runs`, whose first act is
 * `runs.filter(r => !!r.design_id)`, cannot see a single one of them. The work
 * was done, delivered and paid for out of band, and the system had nowhere to
 * write it down.
 *
 * **Inventory orders.** A partner we BOUGHT material from is owed the order's
 * `total_price`. That is not labour on a design and not a task, so it too had
 * no home: ₹28,200 and ₹3,000 of delivered material sat unrecorded.
 *
 * ## 🔴 The check constraint is the load-bearing line here
 *
 * `source_type` is a `text` column with an inline
 * `check ("source_type" in ('design', 'task'))` from Migration20260417120000.
 * Widening the TypeScript enum alone compiles clean and then fails at INSERT
 * against a constraint no type checker reads. The constraint is dropped and
 * recreated below, and that — not the three new columns — is what actually
 * unblocks the feature.
 *
 * ## What this migration does NOT do
 *
 * It adds columns and widens a constraint. It classifies nothing and back-fills
 * nothing: every existing row is a `design` or `task` line and stays exactly as
 * it is. Recording the unbilled retail and inventory payouts is an operator
 * decision about money, and belongs in a route someone can inspect first — the
 * same reasoning Migration20260826230000 gives for refusing to recover run ids
 * from `metadata`. A migration that guesses at money is a migration nobody can
 * review.
 *
 * ⚠️ Widening a source type is not a free extension. Every "already paid for"
 * guard used to fetch priors with `{ design_id: [...] }`, so a line carrying
 * `design_id: null` was invisible to it and its runs could be billed a second
 * time from the design side. Those guards are scoped by PARTNER as of this
 * change — see `workflows/payment_submissions/lib/run-claims`. Any future value
 * added to this constraint must be checked against them first.
 */
export class Migration20260828120000 extends Migration {

  override async up(): Promise<void> {
    // 🔴 The actual unblocker. Postgres names an inline column check
    // `<table>_<column>_check`; dropped by that name, and `if exists` keeps
    // this idempotent on an environment where it has already been widened.
    this.addSql(`alter table if exists "payment_submission_item" drop constraint if exists "payment_submission_item_source_type_check";`);
    this.addSql(`alter table if exists "payment_submission_item" add constraint "payment_submission_item_source_type_check" check ("source_type" in ('design', 'task', 'run', 'inventory_order'));`);

    // The material purchase a line pays for.
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "inventory_order_id" text null;`);
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "inventory_order_name" text null;`);

    /**
     * The commissioning retail order, for a run-sourced line. Denormalised
     * rather than re-derived through the runs, so that "what did order #79 cost
     * us in labour" is one query — the traceability gap #1598 is about.
     */
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "order_id" text null;`);
  }

  override async down(): Promise<void> {
    /**
     * ⚠️ Narrowing the constraint back would fail on any row written as `run`
     * or `inventory_order` while it was open, so those rows are re-sourced to
     * the closest surviving truth before the constraint is restored. A `down()`
     * that throws on real data is a `down()` nobody can run.
     *
     * This is lossy by nature — the ids in the dropped columns are gone. That
     * is the honest cost of reverting, and it is stated here rather than
     * discovered.
     */
    this.addSql(`update "payment_submission_item" set "source_type" = 'design' where "source_type" in ('run', 'inventory_order');`);
    this.addSql(`alter table if exists "payment_submission_item" drop constraint if exists "payment_submission_item_source_type_check";`);
    this.addSql(`alter table if exists "payment_submission_item" add constraint "payment_submission_item_source_type_check" check ("source_type" in ('design', 'task'));`);

    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "inventory_order_id";`);
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "inventory_order_name";`);
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "order_id";`);
  }

}
