import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260423120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_admin" add column if not exists "preferred_language" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_admin" drop column if exists "preferred_language";`);
  }

}
