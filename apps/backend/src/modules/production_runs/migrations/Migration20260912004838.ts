import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #891 S1 — record WHERE a run's output was banked.
 *
 * ⚠️ HAND-NARROWED. `medusa db:generate` emitted this against a local database
 * that was behind main, so it also re-added `cost_currency`, the short-close
 * columns, the approval columns and three jsonb columns — and its `down()`
 * DROPPED them. Those carry payout and sellability decisions on prod. The
 * `if not exists` guards made the up() harmless; the down() was not. Only the
 * three columns this change actually introduces are kept.
 */
export class Migration20260912004838 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "stocked_at_location_id" text null, add column if not exists "stocked_quantity" real null, add column if not exists "stocked_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "stocked_at_location_id", drop column if exists "stocked_quantity", drop column if exists "stocked_at";`);
  }

}
