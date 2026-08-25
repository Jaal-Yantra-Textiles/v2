import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `media_id` + `media_pending_reason` on `messaging_message`.
 *
 * Inbound WhatsApp media was persisted holding Meta's own
 * `lookaside.fbsbx.com` URL, which 401s without a bearer token and carries an
 * `ext=` expiry about five minutes out. When the download did not happen —
 * because the sender had not consented yet, and the consent gate returns
 * before the download — the row was left pointing at a URL that was dead
 * within minutes, with nothing recorded that could fetch the bytes later.
 *
 * `media_id` is that record: Meta retains the bytes ~30 days, so the id is a
 * 30-day claim on a photograph whose URL lives five minutes.
 *
 * 🔑 Generated alongside `fail_reason`, `default_sender_platform_id` and a
 * status-constraint rewrite, all of which the generator re-emitted from a
 * stale snapshot — they already ship in Migration20260630140000 and
 * Migration20260418010000. They are removed here deliberately: the `up` was
 * harmless (`add column if not exists`), but the generated `down` would have
 * DROPPED two columns this migration never created.
 */
export class Migration20260825124753 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "messaging_message" add column if not exists "media_id" text null, add column if not exists "media_pending_reason" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "messaging_message" drop column if exists "media_id", drop column if exists "media_pending_reason";`);
  }

}
