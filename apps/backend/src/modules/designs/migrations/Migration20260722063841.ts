import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260722063841 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design" add column if not exists "aesthetic_keywords" jsonb null, add column if not exists "milestones" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design" drop column if exists "aesthetic_keywords", drop column if exists "milestones";`);
  }

}
