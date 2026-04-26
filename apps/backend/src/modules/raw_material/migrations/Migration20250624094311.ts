import { Migration } from '@mikro-orm/migrations';

export class Migration20250624094311 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "raw_materials" add column if not exists "media" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "raw_materials" drop column if exists "media";`);
  }

}
