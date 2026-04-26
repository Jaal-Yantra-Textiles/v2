import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260328160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "whatsapp_number" text null, add column if not exists "whatsapp_verified" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "whatsapp_number", drop column if exists "whatsapp_verified";`);
  }

}
