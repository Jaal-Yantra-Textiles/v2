import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1268 — let an approval say WHICH templates it meant, by id.
 *
 * `dispatch_template_names` records the approver's intent as labels. Since #1261
 * a label may not identify anything — prod carried two "Stitching" rows differing
 * only by category — and dispatch now refuses an ambiguous name outright, which
 * means an approval recorded that way can no longer be carried out at all.
 *
 * Nullable, no default, no backfill. An existing approval genuinely recorded
 * names and nothing else; inventing ids for it would mean guessing exactly the
 * thing #1261 established we must not guess.
 */
export class Migration20260812140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "dispatch_template_ids" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "dispatch_template_ids";`);
  }

}
