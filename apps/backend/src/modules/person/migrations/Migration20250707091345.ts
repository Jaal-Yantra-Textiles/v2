import { Migration } from '@mikro-orm/migrations';

export class Migration20250707091345 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "person" add column if not exists "public_metadata" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "person" drop column if exists "public_metadata";`);
  }

}
