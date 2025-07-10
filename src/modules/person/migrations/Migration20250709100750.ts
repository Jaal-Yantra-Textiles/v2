import { Migration } from '@mikro-orm/migrations';

export class Migration20250709100750 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "person_address" alter column "latitude" type real using ("latitude"::real);`);
    this.addSql(`alter table if exists "person_address" alter column "longitude" type real using ("longitude"::real);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "person_address" alter column "latitude" type integer using ("latitude"::integer);`);
    this.addSql(`alter table if exists "person_address" alter column "longitude" type integer using ("longitude"::integer);`);
  }

}
