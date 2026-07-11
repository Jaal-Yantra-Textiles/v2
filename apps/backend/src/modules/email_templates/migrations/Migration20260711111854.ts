import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711111854 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "email_template" add column if not exists "locale" text not null default 'en';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "email_template" drop column if exists "locale";`);
  }

}
