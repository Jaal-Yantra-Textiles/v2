import { Migration } from '@mikro-orm/migrations';

export class Migration20250112082718 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "task_template" drop constraint if exists "task_template_category_id_foreign";');

    this.addSql('alter table if exists "task_template" alter column "category_id" type text using ("category_id"::text);');
    this.addSql('alter table if exists "task_template" alter column "category_id" drop not null;');
    this.addSql('alter table if exists "task_template" add constraint "task_template_category_id_foreign" foreign key ("category_id") references "task_category" ("id") on update cascade on delete set null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task_template" drop constraint if exists "task_template_category_id_foreign";');

    this.addSql('alter table if exists "task_template" alter column "category_id" type text using ("category_id"::text);');
    this.addSql('alter table if exists "task_template" alter column "category_id" set not null;');
    this.addSql('alter table if exists "task_template" add constraint "task_template_category_id_foreign" foreign key ("category_id") references "task_category" ("id") on update cascade;');
  }

}
