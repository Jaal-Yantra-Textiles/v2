import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Record WHICH production runs a payment line paid for (#1556).
 *
 * The admin submission screen listed designs, so a payout was only ever
 * traceable to a design — and a design is produced many times. Nothing on the
 * submission said which of those runs the money covered, which means nothing
 * could tell whether a run had already been paid for. The only guard was
 * "this design is in an open submission", which goes away the moment that
 * submission is Approved or Paid: the same completed run could then be billed
 * again, and the second payout would look exactly as legitimate as the first.
 *
 * 🔴 A real column rather than a `metadata` key. The auto-draft subscriber
 * already stashed `metadata.production_run_id` on the SUBMISSION, and that is
 * precisely the shape #1557 took out of the money path: `metadata` is
 * validated as `z.record(z.string(), z.any())` at every boundary, so a
 * misspelt key validates and the guard silently reads nothing. A field that
 * decides whether someone gets paid twice belongs in the schema.
 *
 * jsonb (an ARRAY of run ids) because the line is keyed by design: two
 * completed runs of one design collapse into a single item whose quantity is
 * their sum, and both ids must survive that.
 *
 * ⚠️ The model definition alone only covers a database built from scratch —
 * the generator leaves an existing table alone. Hence the explicit DDL.
 */
export class Migration20260826210000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "production_run_ids" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "production_run_ids";`);
  }

}
