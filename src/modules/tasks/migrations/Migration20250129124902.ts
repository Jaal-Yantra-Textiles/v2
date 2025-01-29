import { Migration } from '@mikro-orm/migrations';

export class Migration20250129124902 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "task" alter column "start_date" drop default;');
    this.addSql('alter table if exists "task" alter column "start_date" type timestamptz using ("start_date"::timestamptz);');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task" alter column "start_date" type timestamptz using ("start_date"::timestamptz);');
    this.addSql('alter table if exists "task" alter column "start_date" set default now();');
  }

}
