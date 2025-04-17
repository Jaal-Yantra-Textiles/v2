import { Migration } from '@mikro-orm/migrations';

export class Migration20250417085315 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "page" drop constraint if exists "page_slug_website_id_unique";`);
    this.addSql(`alter table if exists "website" drop constraint if exists "website_domain_unique";`);
    this.addSql(`create table if not exists "website" ("id" text not null, "domain" text not null, "name" text not null, "description" text null, "status" text check ("status" in ('Active', 'Inactive', 'Maintenance', 'Development')) not null default 'Development', "primary_language" text not null default 'en', "supported_languages" jsonb null, "favicon_url" text null, "analytics_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "website_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_website_domain_unique" ON "website" (domain) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_website_deleted_at" ON "website" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "page" ("id" text not null, "title" text not null, "slug" text not null, "content" text not null, "page_type" text check ("page_type" in ('Home', 'About', 'Contact', 'Blog', 'Product', 'Service', 'Portfolio', 'Landing', 'Custom')) not null default 'Custom', "status" text check ("status" in ('Draft', 'Published', 'Archived')) not null default 'Draft', "meta_title" text null, "meta_description" text null, "meta_keywords" text null, "published_at" timestamptz null, "last_modified" timestamptz not null, "metadata" jsonb null, "website_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "page_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_page_website_id" ON "page" (website_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_page_deleted_at" ON "page" (deleted_at) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_page_slug_website_id_unique" ON "page" (slug, website_id) WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "block" ("id" text not null, "name" text not null, "type" text check ("type" in ('Hero', 'Header', 'Footer', 'MainContent', 'ContactForm', 'Feature', 'Gallery', 'Testimonial', 'Product', 'Section', 'Custom')) not null default 'Content', "content" jsonb not null, "settings" jsonb null, "order" integer not null default 0, "status" text check ("status" in ('Active', 'Inactive', 'Draft')) not null default 'Active', "page_id" text not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "block_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_block_page_id" ON "block" (page_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_block_deleted_at" ON "block" (deleted_at) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "unique_block_type_per_page" ON "block" (page_id, type) WHERE type IN ('Hero', 'Header', 'Footer', 'MainContent', 'ContactForm') AND deleted_at IS NULL;`);

    this.addSql(`alter table if exists "page" add constraint "page_website_id_foreign" foreign key ("website_id") references "website" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table if exists "block" drop constraint if exists "block_page_id_foreign";`);
    this.addSql(`alter table if exists "block" add constraint "block_page_id_foreign" foreign key ("page_id") references "page" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "page" drop constraint if exists "page_website_id_foreign";`);

    this.addSql(`alter table if exists "block" drop constraint if exists "block_page_id_foreign";`);

    this.addSql(`drop table if exists "website" cascade;`);

    this.addSql(`drop table if exists "page" cascade;`);

    this.addSql(`drop table if exists "block" cascade;`);
  }

}
