import { Migration } from '@mikro-orm/migrations';

export class Migration20250724130138 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "email_template" add column if not exists "from" text not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "email_template" drop column if exists "from";`);
  }

}
