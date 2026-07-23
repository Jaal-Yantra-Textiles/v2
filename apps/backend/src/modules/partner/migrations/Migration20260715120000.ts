import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `designer` to the partner.workspace_type check constraint (#338 / #958).
 *
 * Hand-written (Claude-owned) migration. `workspace_type` is a `text` column
 * with a CHECK constraint (see Migration20260411122856); MikroORM names it
 * `partner_workspace_type_check`. To widen the allowed set we drop and re-add
 * the constraint rather than editing the create migration (which would no-op on
 * existing databases — see the repo "migration create-if-not-exists hazard").
 *
 * The new `designer` persona drives the lean designer sidebar and the persona
 * layout default; no data backfill is needed (default stays 'manufacturer').
 */
export class Migration20260715120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner" drop constraint if exists "partner_workspace_type_check";`
    );
    this.addSql(
      `alter table if exists "partner" add constraint "partner_workspace_type_check" check ("workspace_type" in ('seller', 'manufacturer', 'individual', 'designer'));`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "partner" drop constraint if exists "partner_workspace_type_check";`
    );
    this.addSql(
      `alter table if exists "partner" add constraint "partner_workspace_type_check" check ("workspace_type" in ('seller', 'manufacturer', 'individual'));`
    );
  }

}
