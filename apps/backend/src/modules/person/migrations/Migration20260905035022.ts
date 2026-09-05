import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Batch ID-card extraction tables (#1816).
 *
 * 🔴 HAND-TRIMMED from `medusa db:generate person`. The generated version was
 * not safe to ship, in two ways that a green build says nothing about:
 *
 *   1. `up` began by dropping `person_subs_person_id_unique` and
 *      `person_email_unique` — live constraints on tables this change does not
 *      touch, re-emitted because the generator diffs the whole module against
 *      the models rather than against the previous migration.
 *
 *   2. `down` dropped `person`, `person_address`, `person_contact_detail`,
 *      `person_subs` and `person_tags` — every table in the module, none of
 *      them created here. A rollback of THIS migration would have taken the
 *      entire people domain with it.
 *
 * Both are the failure recorded against #1737, twice in one session. Read every
 * generated migration; keep only the statements that belong to your change.
 */
export class Migration20260905035022 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "id_extraction_batch" ("id" text not null, "partner_id" text null, "status" text check ("status" in ('pending_confirmation', 'running', 'completed', 'failed', 'cancelled')) not null default 'pending_confirmation', "interval_ms" integer not null, "transaction_id" text null, "id_number_policy" text check ("id_number_policy" in ('mask', 'discard')) not null default 'mask', "person_type_ids" jsonb null, "notes" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "resume_attempts" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "id_extraction_batch_pkey" primary key ("id"));`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_id_extraction_batch_deleted_at" ON "id_extraction_batch" ("deleted_at") WHERE deleted_at IS NULL;`
    );
    // Every partner-facing read is scoped by partner_id; without this each one
    // is a sequential scan of every batch on the platform.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_id_extraction_batch_partner_id" ON "id_extraction_batch" ("partner_id") WHERE deleted_at IS NULL;`
    );

    this.addSql(
      `create table if not exists "id_extraction_batch_item" ("id" text not null, "position" integer not null, "image_url" text not null, "status" text check ("status" in ('pending', 'completed', 'failed', 'approved', 'discarded')) not null default 'pending', "draft" jsonb null, "person_id" text null, "model_used" jsonb null, "error" text null, "attempts" integer not null default 0, "attempted_at" timestamptz null, "batch_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "id_extraction_batch_item_pkey" primary key ("id"));`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_id_extraction_batch_item_batch_id" ON "id_extraction_batch_item" ("batch_id") WHERE deleted_at IS NULL;`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_id_extraction_batch_item_deleted_at" ON "id_extraction_batch_item" ("deleted_at") WHERE deleted_at IS NULL;`
    );
    // The processing loop's work-list is "items of this batch in this status".
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_id_extraction_batch_item_batch_status" ON "id_extraction_batch_item" ("batch_id", "status") WHERE deleted_at IS NULL;`
    );

    this.addSql(
      `alter table if exists "id_extraction_batch_item" add constraint "id_extraction_batch_item_batch_id_foreign" foreign key ("batch_id") references "id_extraction_batch" ("id") on update cascade;`
    );
  }

  /**
   * Drops only what `up` created. Nothing else in this module is this
   * migration's to remove.
   */
  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "id_extraction_batch_item" drop constraint if exists "id_extraction_batch_item_batch_id_foreign";`
    );
    this.addSql(`drop table if exists "id_extraction_batch_item" cascade;`);
    this.addSql(`drop table if exists "id_extraction_batch" cascade;`);
  }
}
