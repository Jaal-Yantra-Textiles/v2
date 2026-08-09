import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1228 — partner-level opt-in for auto-accepting a production run that is
 * re-sent to them after they let a dispatch go stale.
 *
 * HAND-WRITTEN, not the `db:generate` output. The partner module has no
 * migration snapshot, so the generator emitted a full `create table if not
 * exists "partner" (…)` — which is a silent no-op against the existing prod
 * table, meaning the new column would never actually be added (and its `down`
 * would have dropped the whole table). Only the ALTER below is wanted.
 */
export class Migration20260809052749 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "auto_accept_production_runs" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "auto_accept_production_runs";`);
  }

}
