import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Say WHY a payment line has no run recorded, instead of leaving NULL to mean
 * three incompatible things (#1565).
 *
 * `production_run_ids IS NULL` was true of every row in production — all 13
 * submissions — so the double-pay guard added in #1556 was completely inert on
 * real data while looking, from the screen, exactly like "nothing has been
 * billed yet". Absence read as permission.
 *
 * But the nulls were not one population. They were three:
 *
 *   - **task payouts** — a task is not production output, so there was never a
 *     run to record. NULL here is correct and permanent.
 *   - **run payouts whose run was only ever stashed in `metadata`** — under
 *     `metadata.production_run_id` (the auto-draft subscriber) or
 *     `metadata.source_production_run_id` (the admin screen). Two spellings of
 *     one fact, neither of them the column that guards the money. The run IS
 *     knowable for these; see `backfill-payment-line-run-provenance-job`.
 *   - **run payouts with no provenance anywhere** — genuinely not recorded.
 *
 * ## What this migration classifies, and what it refuses to
 *
 * It sets `no_run` where the row itself proves it: `task_id IS NOT NULL`. That
 * is a fact on the row, not an inference. Everything else defaults to
 * `not_recorded` — the honest reading of "we have not been told".
 *
 * 🔴 It deliberately does NOT read `metadata` to recover run ids, even though
 * that is where nine of them live. A migration runs unattended on every deploy
 * and gets no dry-run; recovering provenance that decides whether a partner is
 * paid twice belongs in a job an operator can inspect first. A migration that
 * guesses at money is a migration nobody can review.
 *
 * ⚠️ `not_recorded` is therefore the state of rows whose run is recoverable but
 * not yet recovered. It is not a claim that the run is unknowable — it is a
 * claim that this column does not know it. The backfill job upgrades them.
 */
export class Migration20260826230000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "run_provenance" text not null default 'not_recorded';`);
    // A task line never had a run. The row proves this about itself, so it is
    // classified rather than left to the default.
    this.addSql(`update "payment_submission_item" set "run_provenance" = 'no_run' where "task_id" is not null;`);
    // Belt and braces: any row that somehow already carries run ids is, by
    // definition, recorded. (No such row exists in production today — every
    // line predates #1556's column — but a migration should not depend on that
    // remaining true between authoring and deploy.)
    this.addSql(`update "payment_submission_item" set "run_provenance" = 'recorded' where "production_run_ids" is not null and jsonb_typeof("production_run_ids") = 'array' and jsonb_array_length("production_run_ids") > 0;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "run_provenance";`);
  }

}
