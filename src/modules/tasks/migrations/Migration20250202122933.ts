import { Migration } from '@mikro-orm/migrations';

export class Migration20250202122933 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "task" drop constraint if exists "task_parent_task_id_foreign";');

    this.addSql('alter table if exists "task_dependency" drop constraint if exists "task_dependency_outgoing_task_id_foreign";');

    this.addSql('alter table if exists "task" add constraint "task_parent_task_id_foreign" foreign key ("parent_task_id") references "task" ("id") on update cascade on delete cascade;');

    this.addSql('alter table if exists "task_dependency" add constraint "task_dependency_outgoing_task_id_foreign" foreign key ("outgoing_task_id") references "task" ("id") on update cascade on delete cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task" drop constraint if exists "task_parent_task_id_foreign";');

    this.addSql('alter table if exists "task_dependency" drop constraint if exists "task_dependency_outgoing_task_id_foreign";');

    this.addSql('alter table if exists "task" add constraint "task_parent_task_id_foreign" foreign key ("parent_task_id") references "task" ("id") on update cascade on delete set null;');

    this.addSql('alter table if exists "task_dependency" add constraint "task_dependency_outgoing_task_id_foreign" foreign key ("outgoing_task_id") references "task" ("id") on update cascade;');
  }

}
