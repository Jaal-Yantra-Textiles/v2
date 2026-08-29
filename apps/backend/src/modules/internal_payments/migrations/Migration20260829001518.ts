import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `internal_payment_details.is_default` — the method approval falls back to
 * when the reviewer names none (#1636).
 *
 * ⚠️ Hand-written. `medusa db:generate` emitted `create table if not exists`
 * for all three of this module's tables instead of an ALTER, because the
 * module has no MikroORM snapshot and the generator therefore believes the
 * schema is empty. On any database where the tables already exist — local and
 * production both — that generated migration adds NOTHING while recording
 * itself as applied. The column would simply never have appeared.
 */
export class Migration20260829001518 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "internal_payment_details" add column if not exists "is_default" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "internal_payment_details" drop column if exists "is_default";`);
  }

}
