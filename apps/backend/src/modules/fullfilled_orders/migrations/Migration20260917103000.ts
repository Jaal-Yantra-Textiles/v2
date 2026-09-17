import { Migration } from "@mikro-orm/migrations";

/**
 * #891 — `goods_transfer.inventory_posted_at`.
 *
 * Separates the physical receipt from the accounting posting, so a transfer can
 * be received before its run is approved and posted later (the 2026-09-13
 * decision: approval gates the posting).
 *
 * HAND-WRITTEN, not `db:generate`d. This module carries no MikroORM snapshot,
 * so the generator rebuilds every model it sees and its `down()` would drop the
 * live `goods_transfer` and `inventory_shipment` tables on a rollback that only
 * ever intended to remove one column. See Migration20260808165525, which was
 * trimmed by hand for the same reason.
 *
 * Additive and nullable: every existing row reads null, which is the truth
 * about them — they were posted by the old unconditional path.
 */
export class Migration20260917103000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "goods_transfer" add column if not exists "inventory_posted_at" timestamptz null;`
    );
  }

  override async down(): Promise<void> {
    // Drops ONLY the column this migration added. Never the table.
    this.addSql(
      `alter table if exists "goods_transfer" drop column if exists "inventory_posted_at";`
    );
  }

}
