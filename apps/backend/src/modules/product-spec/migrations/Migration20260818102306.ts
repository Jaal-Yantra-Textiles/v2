import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260818102306 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_spec" drop constraint if exists "product_spec_product_id_unique";`);
    this.addSql(`create table if not exists "product_spec" ("id" text not null, "product_id" text not null, "weave_technique" text null, "weave_label" text null, "params" jsonb null, "finishes" jsonb null, "notes" text null, "accepting_custom_orders" boolean not null default false, "custom_order_lead_time_days" integer null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_spec_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_spec_product_id_unique" ON "product_spec" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_deleted_at" ON "product_spec" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "product_spec_color" ("id" text not null, "name" text not null, "hex_code" text null, "usage_notes" text null, "order" integer not null default 0, "available" boolean not null default true, "spec_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_spec_color_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_color_spec_id" ON "product_spec_color" ("spec_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_color_deleted_at" ON "product_spec_color" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "product_spec_field" ("id" text not null, "key" text not null, "label" text null, "value" text null, "order" integer not null default 0, "spec_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_spec_field_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_field_spec_id" ON "product_spec_field" ("spec_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_field_deleted_at" ON "product_spec_field" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "product_spec_color" add constraint "product_spec_color_spec_id_foreign" foreign key ("spec_id") references "product_spec" ("id") on update cascade;`);

    this.addSql(`alter table if exists "product_spec_field" add constraint "product_spec_field_spec_id_foreign" foreign key ("spec_id") references "product_spec" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "product_spec_color" drop constraint if exists "product_spec_color_spec_id_foreign";`);

    this.addSql(`alter table if exists "product_spec_field" drop constraint if exists "product_spec_field_spec_id_foreign";`);

    this.addSql(`drop table if exists "product_spec" cascade;`);

    this.addSql(`drop table if exists "product_spec_color" cascade;`);

    this.addSql(`drop table if exists "product_spec_field" cascade;`);
  }

}
