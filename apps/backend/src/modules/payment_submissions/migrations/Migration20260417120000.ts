import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Allow payment submission line items to reference either a design
 * (legacy behaviour) or a task. `design_id` / `design_name` become
 * nullable and `task_id` / `task_name` + `source_type` are introduced.
 */
export class Migration20260417120000 extends Migration {

  override async up(): Promise<void> {
    // design_id/design_name become nullable so task-only items can exist
    this.addSql(`alter table if exists "payment_submission_item" alter column "design_id" drop not null;`);

    // New task columns (nullable)
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "task_id" text null;`);
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "task_name" text null;`);

    // Discriminator — defaults to 'design' so pre-existing rows stay valid
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "source_type" text check ("source_type" in ('design', 'task')) not null default 'design';`);

    // Helpful lookup when filtering items by their task reference
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_submission_item_task_id" ON "payment_submission_item" ("task_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_payment_submission_item_task_id";`);

    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "source_type";`);
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "task_name";`);
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "task_id";`);

    // Restore NOT NULL on design_id — only safe if no task-only rows exist.
    // Leave any task-only rows with a placeholder so the migration still
    // succeeds; operators should reconcile manually if they relied on this.
    this.addSql(`update "payment_submission_item" set "design_id" = '__unknown__' where "design_id" is null;`);
    this.addSql(`alter table if exists "payment_submission_item" alter column "design_id" set not null;`);
  }

}
