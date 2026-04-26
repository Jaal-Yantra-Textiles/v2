import { Migration } from '@mikro-orm/migrations';

export class Migration20250105132111 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "designs" ("id" text not null, "name" text not null, "description" text not null, "inspiration_sources" jsonb null, "design_type" text check ("design_type" in (\'Original\', \'Derivative\', \'Custom\', \'Collaboration\')) not null default \'Original\', "status" text check ("status" in (\'Conceptual\', \'In_Development\', \'Technical_Review\', \'Sample_Production\', \'Revision\', \'Approved\', \'Rejected\', \'On_Hold\')) not null default \'Conceptual\', "priority" text check ("priority" in (\'Low\', \'Medium\', \'High\', \'Urgent\')) not null default \'Medium\', "target_completion_date" timestamptz null, "design_files" jsonb null, "thumbnail_url" text null, "custom_sizes" jsonb null, "color_palette" jsonb null, "tags" jsonb null, "estimated_cost" numeric null, "designer_notes" text null, "feedback_history" jsonb null, "metadata" jsonb null, "raw_estimated_cost" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "designs_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_designs_deleted_at" ON "designs" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "design_specifications" ("id" text not null, "title" text not null, "category" text check ("category" in (\'Measurements\', \'Materials\', \'Construction\', \'Finishing\', \'Packaging\', \'Quality\', \'Other\')) not null, "details" text not null, "measurements" jsonb null, "materials_required" jsonb null, "special_instructions" text null, "attachments" jsonb null, "version" text not null, "status" text check ("status" in (\'Draft\', \'Under_Review\', \'Approved\', \'Rejected\', \'Needs_Revision\')) not null default \'Draft\', "reviewer_notes" text null, "metadata" jsonb null, "design_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_specifications_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_design_specifications_design_id" ON "design_specifications" (design_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_design_specifications_deleted_at" ON "design_specifications" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "design_specifications" add constraint "design_specifications_design_id_foreign" foreign key ("design_id") references "designs" ("id") on update cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "design_specifications" drop constraint if exists "design_specifications_design_id_foreign";');

    this.addSql('drop table if exists "designs" cascade;');

    this.addSql('drop table if exists "design_specifications" cascade;');
  }

}
