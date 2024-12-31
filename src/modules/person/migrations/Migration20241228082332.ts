import { Migration } from '@mikro-orm/migrations';

export class Migration20241228082332 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "person" add column if not exists "state" text check ("state" in (\'Onboarding\', \'Stalled\', \'Conflicted\', \'Onboarding Finished\')) not null default \'Onboarding\';');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "person" drop column if exists "state";');
  }

}
