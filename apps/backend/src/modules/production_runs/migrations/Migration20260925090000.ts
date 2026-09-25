import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2271 — a run's planned and produced output, per size/colour.
 *
 * Hand-written: two nullable jsonb columns and nothing else, so the down()
 * cannot drop anything this change did not add.
 */
export class Migration20260925090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "planned_output" jsonb null, add column if not exists "produced_output" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "planned_output", drop column if exists "produced_output";`);
  }

}
