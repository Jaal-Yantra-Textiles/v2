import { Migration } from '@mikro-orm/migrations';

export class Migration20250805171214 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "folder" drop constraint if exists "folder_parent_folder_id_foreign";`);

    this.addSql(`alter table if exists "folder" alter column "parent_folder_id" type text using ("parent_folder_id"::text);`);
    this.addSql(`alter table if exists "folder" alter column "parent_folder_id" drop not null;`);
    this.addSql(`alter table if exists "folder" add constraint "folder_parent_folder_id_foreign" foreign key ("parent_folder_id") references "folder" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "folder" drop constraint if exists "folder_parent_folder_id_foreign";`);

    this.addSql(`alter table if exists "folder" alter column "parent_folder_id" type text using ("parent_folder_id"::text);`);
    this.addSql(`alter table if exists "folder" alter column "parent_folder_id" set not null;`);
    this.addSql(`alter table if exists "folder" add constraint "folder_parent_folder_id_foreign" foreign key ("parent_folder_id") references "folder" ("id") on update cascade;`);
  }

}
