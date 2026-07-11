import { Migration } from '@mikro-orm/migrations';

export class Migration20260711230000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table if exists "investor" add column if not exists "pan_number" text null;');
    this.addSql('alter table if exists "investor" add column if not exists "aadhar_number" text null;');
    this.addSql('alter table if exists "investor" add column if not exists "international_id_number" text null;');
    this.addSql('alter table if exists "investor" add column if not exists "id_type" text null;');
    // Postgres has no `ADD CONSTRAINT IF NOT EXISTS`; drop-then-add is the
    // idempotent pattern (matches the other investor migrations). Constraint
    // name follows the DML convention `<table>_<column>_check`.
    this.addSql('alter table if exists "investor" drop constraint if exists "investor_id_type_check";');
    this.addSql(`alter table if exists "investor" add constraint "investor_id_type_check" check ("id_type" in ('pan', 'aadhar', 'international'));`);
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "investor" drop constraint if exists "investor_id_type_check";');
    this.addSql('alter table if exists "investor" drop column if exists "pan_number";');
    this.addSql('alter table if exists "investor" drop column if exists "aadhar_number";');
    this.addSql('alter table if exists "investor" drop column if exists "international_id_number";');
    this.addSql('alter table if exists "investor" drop column if exists "id_type";');
  }
}
