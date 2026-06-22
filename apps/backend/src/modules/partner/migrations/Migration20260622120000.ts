import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260622120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "tax_id" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "tax_id_type" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "tax_id";`);
    this.addSql(`alter table if exists "partner" drop column if exists "tax_id_type";`);
  }

}
