import { Migration } from '@mikro-orm/migrations';

export class Migration20250202123934 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "task_dependency" drop constraint if exists "task_dependency_incoming_task_id_foreign";');

    this.addSql('alter table if exists "task_dependency" add constraint "task_dependency_incoming_task_id_foreign" foreign key ("incoming_task_id") references "task" ("id") on update cascade on delete cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task_dependency" drop constraint if exists "task_dependency_incoming_task_id_foreign";');

    this.addSql('alter table if exists "task_dependency" add constraint "task_dependency_incoming_task_id_foreign" foreign key ("incoming_task_id") references "task" ("id") on update cascade;');
  }

}
