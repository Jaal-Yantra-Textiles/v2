import { Migration } from '@mikro-orm/migrations';

export class Migration20250621154457 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "social_platform" add column if not exists "metadata" jsonb null;`);

    this.addSql(`alter table if exists "social_post" add column if not exists "metadata" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "social_platform" drop column if exists "metadata";`);

    this.addSql(`alter table if exists "social_post" drop column if exists "metadata";`);
  }

}
