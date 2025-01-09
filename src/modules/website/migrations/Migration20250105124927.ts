import { Migration } from '@mikro-orm/migrations';

export class Migration20250105124927 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "websites" ("id" text not null, "domain" text not null, "name" text not null, "description" text null, "status" text check ("status" in (\'Active\', \'Inactive\', \'Maintenance\', \'Development\')) not null default \'Development\', "primary_language" text not null default \'en\', "supported_languages" jsonb null, "favicon_url" text null, "analytics_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "websites_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_websites_domain_unique" ON "websites" (domain) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_websites_deleted_at" ON "websites" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "website_pages" ("id" text not null, "title" text not null, "slug" text not null, "content" text not null, "page_type" text check ("page_type" in (\'Home\', \'About\', \'Contact\', \'Blog\', \'Product\', \'Service\', \'Portfolio\', \'Landing\', \'Custom\')) not null default \'Custom\', "status" text check ("status" in (\'Draft\', \'Published\', \'Archived\')) not null default \'Draft\', "meta_title" text null, "meta_description" text null, "meta_keywords" text null, "published_at" timestamptz null, "last_modified" timestamptz not null, "metadata" jsonb null, "website_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "website_pages_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_website_pages_slug_unique" ON "website_pages" (slug) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_website_pages_website_id" ON "website_pages" (website_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_website_pages_deleted_at" ON "website_pages" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "website_pages" add constraint "website_pages_website_id_foreign" foreign key ("website_id") references "websites" ("id") on update cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "website_pages" drop constraint if exists "website_pages_website_id_foreign";');

    this.addSql('drop table if exists "websites" cascade;');

    this.addSql('drop table if exists "website_pages" cascade;');
  }

}
