import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Buyer feedback page: `answered_at` records WHEN the buyer submitted their
 * answer on the public feedback page (`/feedback/:id`).
 *
 * Before this, a post-delivery request looked the same before and after the
 * buyer answered (status stays `pending` for the admin review queue, and
 * `rating` defaults to "three"), so the page could not say "already answered"
 * and the reminder job could nag a buyer who had replied. A typed column, not
 * metadata: metadata is replaced wholesale on update.
 *
 * Hand-written `add column if not exists` so it lands on existing DBs.
 */
export class Migration20261126130500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "feedback" add column if not exists "answered_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "feedback" drop column if exists "answered_at";`);
  }

}
