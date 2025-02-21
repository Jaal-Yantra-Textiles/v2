import { Migration } from '@mikro-orm/migrations';

export class Migration20250219132221 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "page" drop constraint if exists "page_slug_website_id_unique";`);
    this.addSql(`drop index if exists "IDX_page_slug_unique";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_page_slug_website_id_unique" ON "page" (slug, website_id) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_page_slug_website_id_unique";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_page_slug_unique" ON "page" (slug) WHERE deleted_at IS NULL;`);
  }

}
