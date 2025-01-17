import { Migration } from '@mikro-orm/migrations';

export class Migration20250117071308 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "page" ("id" text not null, "title" text not null, "slug" text not null, "content" text not null, "page_type" text check ("page_type" in (\'Home\', \'About\', \'Contact\', \'Blog\', \'Product\', \'Service\', \'Portfolio\', \'Landing\', \'Custom\')) not null default \'Custom\', "status" text check ("status" in (\'Draft\', \'Published\', \'Archived\')) not null default \'Draft\', "meta_title" text null, "meta_description" text null, "meta_keywords" text null, "published_at" timestamptz null, "last_modified" timestamptz not null, "metadata" jsonb null, "website_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "page_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_page_slug_unique" ON "page" (slug) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_page_website_id" ON "page" (website_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_page_deleted_at" ON "page" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "page" add constraint "page_website_id_foreign" foreign key ("website_id") references "website" ("id") on update cascade;');

    this.addSql('drop table if exists "website_page" cascade;');
  }

  async down(): Promise<void> {
    this.addSql('create table if not exists "website_page" ("id" text not null, "title" text not null, "slug" text not null, "content" text not null, "page_type" text check ("page_type" in (\'Home\', \'About\', \'Contact\', \'Blog\', \'Product\', \'Service\', \'Portfolio\', \'Landing\', \'Custom\')) not null default \'Custom\', "status" text check ("status" in (\'Draft\', \'Published\', \'Archived\')) not null default \'Draft\', "meta_title" text null, "meta_description" text null, "meta_keywords" text null, "published_at" timestamptz null, "last_modified" timestamptz not null, "metadata" jsonb null, "website_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "website_page_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_website_page_slug_unique" ON "website_page" (slug) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_website_page_website_id" ON "website_page" (website_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_website_page_deleted_at" ON "website_page" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "website_page" add constraint "website_page_website_id_foreign" foreign key ("website_id") references "website" ("id") on update cascade;');

    this.addSql('drop table if exists "page" cascade;');
  }

}
