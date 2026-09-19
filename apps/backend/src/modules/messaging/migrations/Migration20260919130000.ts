import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `media_filename` on `messaging_message`.
 *
 * WhatsApp carries the sender's own filename on a `document` message
 * (`msg.document.filename`) and the inbound webhook parsed every field beside
 * it — id, mime type, caption — and dropped the name on the floor. Nothing
 * failed; the column simply did not exist, so a partner naming each file for
 * us produced rows indistinguishable from unnamed ones.
 *
 * That name is the only way a sender can say WHICH material a swatch is of.
 * Colour cannot: six of the eight colours on GOF invoice GOF/2026-27/007
 * appear on two different cloths.
 *
 * 🔑 Hand-written rather than generated. `db:generate` diffs the model against
 * whatever is in the local database, and on a stale one it re-emits every
 * column main has added since — with a `down()` that DROPS them. This adds one
 * column and drops exactly that one.
 */
export class Migration20260919130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "messaging_message" add column if not exists "media_filename" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "messaging_message" drop column if exists "media_filename";`);
  }

}
