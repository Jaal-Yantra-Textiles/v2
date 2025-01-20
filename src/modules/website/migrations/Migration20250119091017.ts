import { Migration } from '@mikro-orm/migrations';

export class Migration20250119091017 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "block" ("id" text not null, "name" text not null, "type" text check ("type" in (\'Hero\', \'Feature\', \'Content\', \'Gallery\', \'Testimonial\', \'Contact\', \'Custom\')) not null default \'Content\', "content" jsonb not null, "settings" jsonb null, "order" integer not null default 0, "status" text check ("status" in (\'Active\', \'Inactive\', \'Draft\')) not null default \'Active\', "page_id" text not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "block_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_block_page_id" ON "block" (page_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_block_deleted_at" ON "block" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "block" add constraint "block_page_id_foreign" foreign key ("page_id") references "page" ("id") on update cascade;');

    this.addSql('alter table if exists "page" drop constraint if exists "page_website_id_foreign";');

    this.addSql('alter table if exists "page" add constraint "page_website_id_foreign" foreign key ("website_id") references "website" ("id") on update cascade on delete cascade;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "block" cascade;');

    this.addSql('alter table if exists "page" drop constraint if exists "page_website_id_foreign";');

    this.addSql('alter table if exists "page" add constraint "page_website_id_foreign" foreign key ("website_id") references "website" ("id") on update cascade;');
  }

}
