import { Migration } from '@mikro-orm/migrations';

export class Migration20250707110423 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "person_address" add column if not exists "latitude" integer null, add column if not exists "longitude" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "person_address" drop column if exists "latitude", drop column if exists "longitude";`);
  }

}
