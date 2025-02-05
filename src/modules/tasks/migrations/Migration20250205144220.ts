import { Migration } from '@mikro-orm/migrations';

export class Migration20250205144220 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "task" drop constraint if exists "task_status_check";');

    this.addSql('alter table if exists "task" alter column "status" type text using ("status"::text);');
    this.addSql('alter table if exists "task" add constraint "task_status_check" check ("status" in (\'pending\', \'in_progress\', \'completed\', \'cancelled\', \'accepted\'));');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task" drop constraint if exists "task_status_check";');

    this.addSql('alter table if exists "task" alter column "status" type text using ("status"::text);');
    this.addSql('alter table if exists "task" add constraint "task_status_check" check ("status" in (\'pending\', \'in_progress\', \'completed\', \'cancelled\'));');
  }

}
