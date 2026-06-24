import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #452 — playful artwork-rating in the post-delivery feedback flow.
 *
 * Add two durable, typed columns to the feedback model:
 *  - `chosen_artwork_id`: the media_file id of the artwork the customer
 *    identified with (load-bearing — we want to query/aggregate it).
 *  - `artwork_affinity`: an optional human-readable affinity label.
 *
 * Hand-written `add column if not exists` ALTER (never edit the original
 * `create table if not exists` migration — it won't land on existing DBs).
 */
export class Migration20260624150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "feedback" add column if not exists "chosen_artwork_id" text null;`);
    this.addSql(`alter table if exists "feedback" add column if not exists "artwork_affinity" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_feedback_chosen_artwork_id" ON "feedback" ("chosen_artwork_id") WHERE chosen_artwork_id IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_feedback_chosen_artwork_id";`);
    this.addSql(`alter table if exists "feedback" drop column if exists "artwork_affinity";`);
    this.addSql(`alter table if exists "feedback" drop column if exists "chosen_artwork_id";`);
  }

}
