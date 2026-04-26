import { Migration } from '@mikro-orm/migrations';

export class Migration20250205145320 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "task" add column if not exists "transaction_id" text null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task" drop column if exists "transaction_id";');
  }

}
