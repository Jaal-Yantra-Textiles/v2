import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2029 item 4 — the `unified_order_kind` sidecar table.
 *
 * Hand-written, not `db:generate`: that command diffs the model against
 * whatever the LOCAL database happens to hold, so a stale local db re-emits
 * everything main already added, and the `down()` it writes drops live columns.
 * This one creates exactly one new table and drops exactly that table.
 */
export class Migration20260914090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "unified_order_kind" ("id" text not null, "kind" text check ("kind" in ('collated', 'per_run')) not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "unified_order_kind_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_unified_order_kind_deleted_at" ON "unified_order_kind" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "unified_order_kind" cascade;`);
  }

}
