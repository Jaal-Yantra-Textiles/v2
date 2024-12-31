import { Migration } from '@mikro-orm/migrations';

export class Migration20241222104144 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "person" alter column "avatar" type text using ("avatar"::text);');
    this.addSql('alter table if exists "person" alter column "avatar" drop not null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "person" alter column "avatar" type text using ("avatar"::text);');
    this.addSql('alter table if exists "person" alter column "avatar" set not null;');
  }

}
