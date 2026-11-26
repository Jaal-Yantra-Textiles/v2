import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2625 S2 — `work_note`, the notes on the Pending work board.
 *
 * Hand-trimmed: `db:generate` diffed against a local DB with no `note` table
 * and re-emitted it. That table already exists in prod (Migration20250113165947),
 * so only `work_note` is created here, and `down` drops only `work_note`.
 */
export class Migration20261125223804 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "work_note" ("id" text not null, "ref" serial, "body" text not null, "kind" text check ("kind" in ('note', 'follow_up')) not null default 'note', "status" text check ("status" in ('open', 'done')) not null default 'open', "due_at" timestamptz null, "board" text not null default 'pending-work', "node_key" text null, "entity_name" text null, "entity_id" text null, "href" text null, "created_by" text null, "done_at" timestamptz null, "done_by" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "work_note_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_note_deleted_at" ON "work_note" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_work_note_status" ON "work_note" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_work_note_ref_unique" ON "work_note" ("ref") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "work_note" cascade;`);
  }

}
