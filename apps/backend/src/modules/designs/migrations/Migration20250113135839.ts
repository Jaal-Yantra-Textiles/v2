import { Migration } from '@mikro-orm/migrations';

export class Migration20250113135839 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "design_specifications" drop constraint if exists "design_specifications_design_id_foreign";');

    this.addSql('create table if not exists "design" ("id" text not null, "name" text not null, "description" text not null, "inspiration_sources" jsonb null, "design_type" text check ("design_type" in (\'Original\', \'Derivative\', \'Custom\', \'Collaboration\')) not null default \'Original\', "status" text check ("status" in (\'Conceptual\', \'In_Development\', \'Technical_Review\', \'Sample_Production\', \'Revision\', \'Approved\', \'Rejected\', \'On_Hold\')) not null default \'Conceptual\', "priority" text check ("priority" in (\'Low\', \'Medium\', \'High\', \'Urgent\')) not null default \'Medium\', "target_completion_date" timestamptz null, "design_files" jsonb null, "thumbnail_url" text null, "custom_sizes" jsonb null, "color_palette" jsonb null, "tags" jsonb null, "estimated_cost" numeric null, "designer_notes" text null, "feedback_history" jsonb null, "metadata" jsonb null, "raw_estimated_cost" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_design_deleted_at" ON "design" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('drop table if exists "designs" cascade;');

    this.addSql('alter table if exists "design_specifications" drop constraint if exists "design_specifications_design_id_foreign";');

    this.addSql('alter table if exists "design_specifications" add constraint "design_specifications_design_id_foreign" foreign key ("design_id") references "design" ("id") on update cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "design_specifications" drop constraint if exists "design_specifications_design_id_foreign";');

    this.addSql('create table if not exists "designs" ("id" text not null, "name" text not null, "description" text not null, "inspiration_sources" jsonb null, "design_type" text check ("design_type" in (\'Original\', \'Derivative\', \'Custom\', \'Collaboration\')) not null default \'Original\', "status" text check ("status" in (\'Conceptual\', \'In_Development\', \'Technical_Review\', \'Sample_Production\', \'Revision\', \'Approved\', \'Rejected\', \'On_Hold\')) not null default \'Conceptual\', "priority" text check ("priority" in (\'Low\', \'Medium\', \'High\', \'Urgent\')) not null default \'Medium\', "target_completion_date" timestamptz null, "design_files" jsonb null, "thumbnail_url" text null, "custom_sizes" jsonb null, "color_palette" jsonb null, "tags" jsonb null, "estimated_cost" numeric null, "designer_notes" text null, "feedback_history" jsonb null, "metadata" jsonb null, "raw_estimated_cost" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "designs_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_designs_deleted_at" ON "designs" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('drop table if exists "design" cascade;');

    this.addSql('alter table if exists "design_specifications" drop constraint if exists "design_specifications_design_id_foreign";');

    this.addSql('alter table if exists "design_specifications" add constraint "design_specifications_design_id_foreign" foreign key ("design_id") references "designs" ("id") on update cascade;');
  }

}
