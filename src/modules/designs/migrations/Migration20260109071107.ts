import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260109071107 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design" add column if not exists "origin_source" text check ("origin_source" in ('manual', 'ai-mistral', 'ai-other')) not null default 'manual';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design" drop column if exists "origin_source";`);
  }

}
