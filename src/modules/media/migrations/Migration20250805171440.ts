import { Migration } from '@mikro-orm/migrations';

export class Migration20250805171440 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "media_file" drop constraint if exists "media_file_folder_id_foreign";`);

    this.addSql(`alter table if exists "media_file" alter column "folder_id" type text using ("folder_id"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "folder_id" drop not null;`);
    this.addSql(`alter table if exists "media_file" add constraint "media_file_folder_id_foreign" foreign key ("folder_id") references "folder" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "media_file" drop constraint if exists "media_file_folder_id_foreign";`);

    this.addSql(`alter table if exists "media_file" alter column "folder_id" type text using ("folder_id"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "folder_id" set not null;`);
    this.addSql(`alter table if exists "media_file" add constraint "media_file_folder_id_foreign" foreign key ("folder_id") references "folder" ("id") on update cascade;`);
  }

}
