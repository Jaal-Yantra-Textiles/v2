import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the artisan_product_detail table (issue #859 S3 / #862).
 *
 * Hand-written (Claude-owned) create migration. Mirrors what DML would
 * generate for the model: the unique product_id gets a partial unique index,
 * plus the standard deleted_at index.
 */
export class Migration20260711170000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "artisan_product_detail" ("id" text not null, "product_id" text not null, "made_to_order" boolean not null default false, "lead_time_days" integer null, "lead_time_label" text null, "min_order_quantity" integer null, "maker_story" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "artisan_product_detail_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_artisan_product_detail_product_id_unique" ON "artisan_product_detail" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_artisan_product_detail_deleted_at" ON "artisan_product_detail" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "artisan_product_detail" cascade;`);
  }

}
