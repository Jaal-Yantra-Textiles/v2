import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260819044713 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "product_spec_option" ("id" text not null, "key" text not null, "label" text null, "help_text" text null, "required" boolean not null default false, "order" integer not null default 0, "spec_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_spec_option_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_option_spec_id" ON "product_spec_option" ("spec_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_option_deleted_at" ON "product_spec_option" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "product_spec_option_value" ("id" text not null, "label" text not null, "note" text null, "order" integer not null default 0, "available" boolean not null default true, "option_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_spec_option_value_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_option_value_option_id" ON "product_spec_option_value" ("option_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_spec_option_value_deleted_at" ON "product_spec_option_value" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "product_spec_option" add constraint "product_spec_option_spec_id_foreign" foreign key ("spec_id") references "product_spec" ("id") on update cascade;`);

    this.addSql(`alter table if exists "product_spec_option_value" add constraint "product_spec_option_value_option_id_foreign" foreign key ("option_id") references "product_spec_option" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "product_spec_option_value" drop constraint if exists "product_spec_option_value_option_id_foreign";`);

    this.addSql(`drop table if exists "product_spec_option" cascade;`);

    this.addSql(`drop table if exists "product_spec_option_value" cascade;`);
  }

}
