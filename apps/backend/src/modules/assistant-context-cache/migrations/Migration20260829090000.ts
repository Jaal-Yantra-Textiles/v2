import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `entity_resolutions` to assistant_context_cache.
 *
 * Until now the cache only kept a flat `entity_ids` array, which a later turn
 * could show but never query ("you looked at these"). `entity_resolutions`
 * stores the natural key each id was found under — [{type, key, value, id}]
 * — so the plan executor's `resolve` step can answer "what is the id of
 * customer delhi@gmail.com?" without re-running the lookup tool.
 *
 * Defaults to '[]' so existing rows are valid immediately; no backfill needed.
 *
 * 🔴 RENAMED from `Migration20260828120000`, which it shared byte-for-byte with
 * `payment_submissions/migrations/Migration20260828120000.ts`.
 *
 * Medusa's ledger (`mikro_orm_migrations`) records a migration by NAME ALONE,
 * with no module qualifier. Two modules using one name means the first to run
 * claims it and the second is marked applied without ever executing — silently,
 * and permanently, because a redeploy sees the name and skips again.
 *
 * Which one loses depends on the order the modules happen to migrate in, so the
 * two environments diverged:
 *
 *   - PROD ran `payment_submissions` first (deploy 06:28, before this file
 *     existed). This migration's deploy then logged
 *     `MODULE: assistant_context_cache → Skipped. Database is up-to-date`
 *     and `entity_resolutions` was never created.
 *   - LOCAL ran this one first, so `entity_resolutions` exists there while
 *     `payment_submission_item.inventory_order_id` does not — and
 *     `db:migrate` reports "No pending migration scripts to execute" on a
 *     database that is provably missing a column.
 *
 * ⚠️ The original header claimed a "distinct class name + timestamp"; both were
 * in fact identical to the other module's. Stating the intent is not the same
 * as checking it — `find src/modules -name "Migration<ts>.ts"` is.
 *
 * The SQL is `add column if not exists`, so re-running where the column already
 * exists (local) is a no-op, and the same file repairs prod.
 */
export class Migration20260829090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table "assistant_context_cache" add column if not exists "entity_resolutions" jsonb not null default '[]';`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "assistant_context_cache" drop column if exists "entity_resolutions";`
    );
  }
}