import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Record when a quote was corrected in place, without touching the status enum.
 *
 * One additive nullable column — idempotent and safe to re-run (#1208). The
 * enum is deliberately left alone: an adjusted quote is still `active`, and
 * widening the enum would make every `status=active` filter miss it.
 */
export class Migration20260825090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" add column if not exists "adjusted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop column if exists "adjusted_at";`);
  }

}
