import { Migration } from '@mikro-orm/migrations';

export class Migration20241231155411 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "tag" alter column "name" type jsonb using ("name"::jsonb);');
    this.addSql('alter table if exists "tag" alter column "name" drop not null;');
    this.addSql('drop index if exists "IDX_tag_name_unique";');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "tag" alter column "name" type text using ("name"::text);');
    this.addSql('alter table if exists "tag" alter column "name" set not null;');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tag_name_unique" ON "tag" (name) WHERE deleted_at IS NULL;');
  }

}
