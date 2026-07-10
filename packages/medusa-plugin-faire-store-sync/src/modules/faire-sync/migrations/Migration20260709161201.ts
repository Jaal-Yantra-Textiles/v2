import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260709161201 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "faire_sync_account" add column if not exists "auth_mode" text check ("auth_mode" in ('oauth', 'apiKey')) not null default 'oauth';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "faire_sync_account" drop column if exists "auth_mode";`);
  }

}
