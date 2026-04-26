import { Migration } from '@mikro-orm/migrations';

export class Migration20250725100443 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "email_template" add column if not exists "cc" text null, add column if not exists "bcc" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "email_template" drop column if exists "cc", drop column if exists "bcc";`);
  }

}
