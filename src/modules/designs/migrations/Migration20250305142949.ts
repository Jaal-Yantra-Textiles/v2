import { Migration } from '@mikro-orm/migrations';

export class Migration20250305142949 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design_specifications" drop constraint if exists "design_specifications_design_id_foreign";`);

    this.addSql(`alter table if exists "design" add column if not exists "media_files" jsonb null;`);

    this.addSql(`alter table if exists "design_specifications" add constraint "design_specifications_design_id_foreign" foreign key ("design_id") references "design" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design_specifications" drop constraint if exists "design_specifications_design_id_foreign";`);

    this.addSql(`alter table if exists "design" drop column if exists "media_files";`);

    this.addSql(`alter table if exists "design_specifications" add constraint "design_specifications_design_id_foreign" foreign key ("design_id") references "design" ("id") on update cascade;`);
  }

}
