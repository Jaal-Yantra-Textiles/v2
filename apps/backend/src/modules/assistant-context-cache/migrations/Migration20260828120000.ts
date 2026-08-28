import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `entity_resolutions` to assistant_context_cache.
 *
 * Until now the cache only kept a flat `entity_ids` array, which a later turn
 * could show but never query ("you looked at these"). `entity_resolutions`
 * stores the natural key each id was found under — [{type, key, value, id}]
 * — so the plan executor's `resolve` step can answer "what is the id of
 * customer delhi@gmail.com?" without re-running the lookup tool.
 *
 * Defaults to '[]' so existing rows are valid immediately; no backfill needed.
 *
 * Distinct class name + timestamp to avoid the Medusa migration-name-collision
 * hazard.
 */
export class Migration20260828120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table "assistant_context_cache" add column if not exists "entity_resolutions" jsonb not null default '[]';`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "assistant_context_cache" drop column if exists "entity_resolutions";`
    );
  }
}