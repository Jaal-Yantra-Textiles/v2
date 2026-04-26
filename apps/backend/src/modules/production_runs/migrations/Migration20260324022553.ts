import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260324022553 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "run_type" text check ("run_type" in ('production', 'sample')) not null default 'production', add column if not exists "accepted_at" timestamptz null, add column if not exists "started_at" timestamptz null, add column if not exists "finished_at" timestamptz null, add column if not exists "completed_at" timestamptz null, add column if not exists "dispatch_state" text check ("dispatch_state" in ('idle', 'awaiting_templates', 'completed')) not null default 'idle', add column if not exists "dispatch_started_at" timestamptz null, add column if not exists "dispatch_completed_at" timestamptz null, add column if not exists "dispatch_template_names" jsonb null;`);

    // Backfill accepted_at from metadata.acceptance.accepted_at
    this.addSql(`update "production_runs" set "accepted_at" = (metadata->'acceptance'->>'accepted_at')::timestamptz where metadata->'acceptance'->>'accepted_at' is not null and "accepted_at" is null;`);

    // Backfill dispatch state from metadata.dispatch
    this.addSql(`update "production_runs" set "dispatch_state" = case when metadata->'dispatch'->>'state' = 'awaiting_templates' then 'awaiting_templates' when metadata->'dispatch'->>'state' = 'completed' then 'completed' else 'idle' end, "dispatch_started_at" = (metadata->'dispatch'->>'started_at')::timestamptz, "dispatch_completed_at" = (metadata->'dispatch'->>'completed_at')::timestamptz where metadata->'dispatch'->>'state' is not null;`);

    // Backfill dispatch_template_names from metadata
    this.addSql(`update "production_runs" set "dispatch_template_names" = metadata->'dispatch_template_names' where metadata->'dispatch_template_names' is not null and "dispatch_template_names" is null;`);

    // Backfill completed_at for already-completed runs
    this.addSql(`update "production_runs" set "completed_at" = "updated_at" where status = 'completed' and "completed_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "run_type", drop column if exists "accepted_at", drop column if exists "started_at", drop column if exists "finished_at", drop column if exists "completed_at", drop column if exists "dispatch_state", drop column if exists "dispatch_started_at", drop column if exists "dispatch_completed_at", drop column if exists "dispatch_template_names";`);
  }

}
