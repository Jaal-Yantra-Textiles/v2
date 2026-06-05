import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Roadmap #6 Phase 4 — partner-originated production runs.
 *
 * Adds `execution_mode` (in_house | outsourced) + `sub_partner_id` to
 * `production_runs` so a partner running production for themselves can
 * distinguish self-made work from work farmed out to a sub-partner,
 * and cost tracking can isolate per mode.
 *
 * Hand-written incremental ALTER (the generator emits a full
 * `create table if not exists` snapshot, a no-op on the existing prod
 * table). `add column if not exists` keeps it idempotent. See memory
 * `reference_medusa_migration_create_if_not_exists_hazard`.
 */
export class Migration20260605150400 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "production_runs" add column if not exists "execution_mode" text check ("execution_mode" in ('in_house', 'outsourced')) not null default 'in_house';`
    );
    this.addSql(
      `alter table if exists "production_runs" add column if not exists "sub_partner_id" text null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "production_runs" drop column if exists "execution_mode";`
    );
    this.addSql(
      `alter table if exists "production_runs" drop column if exists "sub_partner_id";`
    );
  }
}
