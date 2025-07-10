import { Migration } from '@mikro-orm/migrations';

export class Migration20250707101223 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "person" alter column "email" type text using ("email"::text);`);
    this.addSql(`alter table if exists "person" alter column "email" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "person" alter column "email" type text using ("email"::text);`);
    this.addSql(`alter table if exists "person" alter column "email" set not null;`);
  }

}
