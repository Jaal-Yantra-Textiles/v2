import { Migration } from '@mikro-orm/migrations';

export class Migration20250724130728 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "email_template" alter column "to" type text using ("to"::text);`);
    this.addSql(`alter table if exists "email_template" alter column "to" drop not null;`);
    this.addSql(`alter table if exists "email_template" alter column "from" type text using ("from"::text);`);
    this.addSql(`alter table if exists "email_template" alter column "from" set default 'no-reply@jyt.com';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "email_template" alter column "to" type text using ("to"::text);`);
    this.addSql(`alter table if exists "email_template" alter column "to" set not null;`);
    this.addSql(`alter table if exists "email_template" alter column "from" drop default;`);
    this.addSql(`alter table if exists "email_template" alter column "from" type text using ("from"::text);`);
  }

}
