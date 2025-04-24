import { Migration } from '@mikro-orm/migrations';

export class Migration20250424094755 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design" add column if not exists "moodboard" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design" drop column if exists "moodboard";`);
  }

}
