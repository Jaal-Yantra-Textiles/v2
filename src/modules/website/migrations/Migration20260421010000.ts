import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260421010000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "website_domain" (
      "id" text not null,
      "domain" text not null,
      "is_primary" boolean not null default false,
      "website_id" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "website_domain_pkey" primary key ("id")
    );`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_website_domain_domain_unique" ON "website_domain" ("domain") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_website_domain_website_id" ON "website_domain" ("website_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_website_domain_deleted_at" ON "website_domain" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table "website_domain" add constraint "website_domain_website_id_foreign" foreign key ("website_id") references "website" ("id") on update cascade on delete cascade;`);

    // Seed one row per existing website with is_primary=true mirroring website.domain.
    // Use website.id as the deterministic id so re-runs are idempotent.
    this.addSql(`insert into "website_domain" ("id", "domain", "is_primary", "website_id")
      select 'wd_' || w."id", w."domain", true, w."id"
      from "website" w
      where w."deleted_at" is null
      on conflict ("id") do nothing;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "website_domain" cascade;`);
  }

}
