import { Migration } from '@mikro-orm/migrations';

export class Migration20250709101103 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "person_address" add column if not exists "raw_latitude" jsonb null, add column if not exists "raw_longitude" jsonb null;`);
    this.addSql(`alter table if exists "person_address" alter column "latitude" type numeric using ("latitude"::numeric);`);
    this.addSql(`alter table if exists "person_address" alter column "longitude" type numeric using ("longitude"::numeric);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "person_address" drop column if exists "raw_latitude", drop column if exists "raw_longitude";`);

    this.addSql(`alter table if exists "person_address" alter column "latitude" type real using ("latitude"::real);`);
    this.addSql(`alter table if exists "person_address" alter column "longitude" type real using ("longitude"::real);`);
  }

}
