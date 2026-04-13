import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260413020000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "messaging_message" add column if not exists "reply_to_id" text null;`);
    this.addSql(`alter table if exists "messaging_message" add column if not exists "reply_to_snapshot" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "messaging_message" drop column if exists "reply_to_id";`);
    this.addSql(`alter table if exists "messaging_message" drop column if exists "reply_to_snapshot";`);
  }
}
