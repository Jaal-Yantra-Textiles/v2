import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260821002053 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_quote_line" ("id" text not null, "quote_id" text not null, "variant_id" text not null, "product_id" text null, "quantity" integer not null, "position" integer not null default 0, "quoted_unit_amount" numeric null, "quoted_subtotal" numeric null, "quoted_unit_weight_grams" integer null, "quoted_weight_source" text check ("quoted_weight_source" in ('variant', 'product')) null, "note" text null, "metadata" jsonb null, "raw_quoted_unit_amount" jsonb null, "raw_quoted_subtotal" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_quote_line_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_line_quote_id" ON "partner_quote_line" ("quote_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_line_deleted_at" ON "partner_quote_line" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "partner_quote_line" add constraint "partner_quote_line_quote_id_foreign" foreign key ("quote_id") references "partner_quote" ("id") on update cascade;`);

    this.addSql(`alter table if exists "partner_quote" drop column if exists "variant_id", drop column if exists "product_id", drop column if exists "quantity", drop column if exists "quoted_unit_amount", drop column if exists "quoted_weight_source", drop column if exists "raw_quoted_unit_amount";`);

    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_weight_grams" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_quote_line" cascade;`);

    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_weight_grams";`);

    this.addSql(`alter table if exists "partner_quote" add column if not exists "variant_id" text not null, add column if not exists "product_id" text null, add column if not exists "quantity" integer not null, add column if not exists "quoted_unit_amount" numeric null, add column if not exists "quoted_weight_source" text check ("quoted_weight_source" in ('variant', 'product')) null, add column if not exists "raw_quoted_unit_amount" jsonb null;`);
  }

}
