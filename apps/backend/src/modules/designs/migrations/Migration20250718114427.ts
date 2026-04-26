import { Migration } from '@mikro-orm/migrations';

export class Migration20250718114427 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design" drop constraint if exists "design_status_check";`);

    this.addSql(`alter table if exists "design" add constraint "design_status_check" check("status" in ('Conceptual', 'In_Development', 'Technical_Review', 'Sample_Production', 'Revision', 'Approved', 'Rejected', 'On_Hold', 'Commerce_Ready'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design" drop constraint if exists "design_status_check";`);

    this.addSql(`alter table if exists "design" add constraint "design_status_check" check("status" in ('Conceptual', 'In_Development', 'Technical_Review', 'Sample_Production', 'Revision', 'Approved', 'Rejected', 'On_Hold'));`);
  }

}
