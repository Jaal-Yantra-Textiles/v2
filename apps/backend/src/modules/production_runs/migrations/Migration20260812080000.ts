import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1265 — record WHICH task templates a run was actually dispatched with.
 *
 * `dispatch_template_names` is approval-time INTENT and is null for any run whose
 * templates were chosen at dispatch time, so the only evidence of what really ran
 * was the tasks themselves. Ids, not names: names are not identities (#1261) and
 * the deduplicate-task-template-names job renames them.
 *
 * Nullable with no default and no backfill — an existing run genuinely has no
 * record, and writing an empty array would claim it was dispatched with nothing.
 */
export class Migration20260812080000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "dispatched_template_ids" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "dispatched_template_ids";`);
  }

}
