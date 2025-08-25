import { Migration } from '@mikro-orm/migrations';

export class Migration20250825111003 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "task" drop constraint if exists "task_status_check";`);

    this.addSql(`alter table if exists "task" add constraint "task_status_check" check("status" in ('pending', 'in_progress', 'completed', 'cancelled', 'accepted', 'assigned'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "task" drop constraint if exists "task_status_check";`);

    this.addSql(`alter table if exists "task" add constraint "task_status_check" check("status" in ('pending', 'in_progress', 'completed', 'cancelled', 'accepted'));`);
  }

}
