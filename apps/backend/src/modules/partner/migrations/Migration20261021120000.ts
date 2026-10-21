import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2444 — opt-in public partner page.
 *
 * HAND-WRITTEN for the same reason as Migration20260809052749: the partner
 * module has no snapshot, so `db:generate` emits a no-op `create table if not
 * exists` instead of this ALTER.
 */
export class Migration20261021120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "is_public" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "is_public";`);
  }

}
