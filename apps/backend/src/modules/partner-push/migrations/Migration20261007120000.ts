import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The first migration created `partner_push_token` without `deleted_at`, but
 * every DML model is soft-deletable and its reads filter on it — so the
 * device-token upsert failed with `column p0.deleted_at does not exist` and no
 * phone could ever register for a push. Found 2026-10-07 registering the
 * Android app against a fresh database.
 */
export class Migration20261007120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_push_token" add column if not exists "deleted_at" timestamptz null;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_push_token_deleted_at" ON "partner_push_token" ("deleted_at") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_partner_push_token_deleted_at";`)
    this.addSql(`alter table if exists "partner_push_token" drop column if exists "deleted_at";`)
  }
}
