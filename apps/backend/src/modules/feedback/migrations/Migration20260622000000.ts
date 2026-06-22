import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #452 — add a durable `order_id` link to the feedback model so a
 * post-delivery feedback request can be tied to its order (and made
 * idempotent) without relying on the metadata blob.
 *
 * Hand-written `add column if not exists` ALTER (never edit the original
 * `create table if not exists` migration — it won't land on existing DBs).
 */
export class Migration20260622000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "feedback" add column if not exists "order_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_feedback_order_id" ON "feedback" ("order_id") WHERE order_id IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_feedback_order_id";`);
    this.addSql(`alter table if exists "feedback" drop column if exists "order_id";`);
  }

}
