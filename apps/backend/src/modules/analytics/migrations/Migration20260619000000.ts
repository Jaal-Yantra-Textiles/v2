import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #344 — add a client-supplied idempotency key to analytics_event so the
 * batch-ingest path / edge worker can dedupe retried batches cross-request.
 *
 * Hand-written ALTER (add column IF NOT EXISTS) so it lands on EXISTING DBs —
 * editing the original create-table migration would never re-run on prod.
 */
export class Migration20260619000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "analytics_event" add column if not exists "event_id" text null;`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_analytics_event_event_id" ON "analytics_event" ("event_id") WHERE deleted_at IS NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_analytics_event_event_id";`);
    this.addSql(
      `alter table if exists "analytics_event" drop column if exists "event_id";`
    );
  }
}
