import { Migration } from '@mikro-orm/migrations';

export class Migration20250621140518 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "social_post" add column if not exists "name" text not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "social_post" drop column if exists "name";`);
  }

}
