import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260421020000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "vercel_linked" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "vercel_linked";`);
  }

}
