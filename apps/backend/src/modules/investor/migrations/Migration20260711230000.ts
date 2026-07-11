import { Migration } from '@mikro-orm/migrations';

export class Migration20260711230000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table if exists "investor" add column if not exists "pan_number" text null;');
    this.addSql('alter table if exists "investor" add column if not exists "aadhar_number" text null;');
    this.addSql('alter table if exists "investor" add column if not exists "international_id_number" text null;');
    this.addSql(`
      alter table if exists "investor" add column if not exists "id_type" text null;
      alter table if exists "investor" add constraint if not exists "CK_investor_id_type" check (id_type in ('pan', 'aadhar', 'international'));
    `);
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "investor" drop column if exists "pan_number";');
    this.addSql('alter table if exists "investor" drop column if exists "aadhar_number";');
    this.addSql('alter table if exists "investor" drop column if exists "international_id_number";');
    this.addSql('alter table if exists "investor" drop column if exists "id_type";');
  }
}
