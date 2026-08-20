import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260820230058 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop constraint if exists "partner_quote_token_hash_unique";`);
    this.addSql(`create table if not exists "partner_quote" ("id" text not null, "partner_id" text not null, "store_id" text null, "variant_id" text not null, "product_id" text null, "quantity" integer not null, "destination_country_code" text not null, "destination_postal_code" text null, "destination_city" text null, "currency_code" text not null, "region_id" text null, "recipient_name" text null, "recipient_company" text null, "email_sent_to" text null, "partner_note" text null, "quoted_unit_amount" numeric null, "quoted_subtotal" numeric null, "quoted_freight" numeric null, "quoted_landed_total" numeric null, "quoted_weight_source" text check ("quoted_weight_source" in ('variant', 'product')) null, "quoted_at" timestamptz null, "token_hash" text not null, "status" text check ("status" in ('active', 'revoked')) not null default 'active', "expires_at" timestamptz null, "viewed_at" timestamptz null, "last_viewed_at" timestamptz null, "view_count" integer not null default 0, "created_by" text null, "metadata" jsonb null, "raw_quoted_unit_amount" jsonb null, "raw_quoted_subtotal" jsonb null, "raw_quoted_freight" jsonb null, "raw_quoted_landed_total" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_quote_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_quote_token_hash_unique" ON "partner_quote" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_deleted_at" ON "partner_quote" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_quote" cascade;`);
  }

}
