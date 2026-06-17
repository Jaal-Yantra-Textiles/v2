import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #459 P1 — compile-on-save. Adds `compiled_plan` (jsonb) + `compiled_hash`
 * (text) to `visual_flow`. The compiled plan is the normalized, validated
 * execution artifact derived from the canvas/operations at save time
 * (topological levels, per-node handler/options, branch handles); the hash
 * keys the Redis plan cache.
 *
 * Hand-written `ADD COLUMN IF NOT EXISTS` rather than editing a
 * `create table if not exists` migration: the visual_flow table already exists
 * on every deployed DB, so a create-table edit would never land the new columns
 * (see reference_medusa_migration_create_if_not_exists_hazard).
 */
export class Migration20260617000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow" add column if not exists "compiled_plan" jsonb null;`);
    this.addSql(`alter table if exists "visual_flow" add column if not exists "compiled_hash" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow" drop column if exists "compiled_plan";`);
    this.addSql(`alter table if exists "visual_flow" drop column if exists "compiled_hash";`);
  }

}
