import { Migration } from "@mikro-orm/migrations"

/**
 * #2017 — one moodboard per OWNER, replacing the shared blob.
 *
 * `design.moodboard` is a single `jsonb` column. An admin and a partner
 * editing "their" boards were editing the same value, and the partner save
 * replaced it wholesale — last write wins, silently, with a 200.
 *
 * ## The column is NOT dropped
 *
 * It stays as the read fallback until every reader has moved (the admin
 * dashboard, the mastra tools, partner-ui). Dropping it in the same change
 * would make an unmigrated design render as a board nobody has ever touched.
 *
 * ## Backfill
 *
 * Every design holding a non-empty scene gets a `core` row carrying it. The
 * blob is COPIED, not moved: after this migration the same scene exists in
 * both places, which is what makes the change reversible and what lets the
 * old readers keep working while they are converted one at a time.
 *
 * "Non-empty" is `jsonb_array_length(moodboard->'elements') > 0`, guarded by a
 * type check — a board that is `{}` or `{"elements": []}` is a board nobody
 * has drawn on, and minting a core row for it would turn "never started" into
 * "started and blank" across the whole table.
 *
 * Idempotent: the insert skips designs that already have a core row, so a
 * re-run adds nothing.
 */
export class Migration20260919120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "design_moodboard" (
        "id" text not null,
        "owner_type" text not null default 'core',
        "partner_id" text null,
        "title" text null,
        "scene" jsonb null,
        "thumbnail_url" text null,
        "metadata" jsonb null,
        "design_id" text not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "design_moodboard_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      alter table if exists "design_moodboard"
        drop constraint if exists "design_moodboard_owner_type_check";
    `)
    this.addSql(`
      alter table if exists "design_moodboard"
        add constraint "design_moodboard_owner_type_check"
        check ("owner_type" in ('core', 'partner'));
    `)

    /**
     * A partner board must name its partner and a core board must not. Without
     * this a partner row with a null `partner_id` would fall into the core
     * unique index's blind spot and become a second, unowned board.
     */
    this.addSql(`
      alter table if exists "design_moodboard"
        drop constraint if exists "design_moodboard_owner_partner_check";
    `)
    this.addSql(`
      alter table if exists "design_moodboard"
        add constraint "design_moodboard_owner_partner_check"
        check (
          ("owner_type" = 'core' and "partner_id" is null)
          or ("owner_type" = 'partner' and "partner_id" is not null)
        );
    `)

    this.addSql(`
      alter table if exists "design_moodboard"
        drop constraint if exists "design_moodboard_design_id_foreign";
    `)
    this.addSql(`
      alter table if exists "design_moodboard"
        add constraint "design_moodboard_design_id_foreign"
        foreign key ("design_id") references "design" ("id") on update cascade on delete cascade;
    `)

    this.addSql(
      `create index if not exists "IDX_design_moodboard_design_id" on "design_moodboard" ("design_id") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_design_moodboard_partner_id" on "design_moodboard" ("partner_id") where "deleted_at" is null;`
    )
    // At most ONE core board per design.
    this.addSql(
      `create unique index if not exists "IDX_design_moodboard_core_unique" on "design_moodboard" ("design_id") where "owner_type" = 'core' and "deleted_at" is null;`
    )
    /**
     * At most one board per partner per design. `partner_id is not null`
     * matters: Postgres treats every NULL as distinct, so without it the core
     * rows slip past and this index constrains nothing the one above does not
     * already cover.
     */
    this.addSql(
      `create unique index if not exists "IDX_design_moodboard_partner_unique" on "design_moodboard" ("design_id", "partner_id") where "partner_id" is not null and "deleted_at" is null;`
    )

    // Backfill: the existing blob becomes the core board. Copied, not moved.
    this.addSql(`
      insert into "design_moodboard" ("id", "owner_type", "partner_id", "title", "scene", "design_id", "created_at", "updated_at")
      select
        'dmb_' || replace(gen_random_uuid()::text, '-', ''),
        'core',
        null,
        null,
        d."moodboard",
        d."id",
        now(),
        now()
      from "design" d
      where d."moodboard" is not null
        and jsonb_typeof(d."moodboard") = 'object'
        and jsonb_typeof(d."moodboard"->'elements') = 'array'
        and jsonb_array_length(d."moodboard"->'elements') > 0
        and d."deleted_at" is null
        and not exists (
          select 1 from "design_moodboard" m
          where m."design_id" = d."id"
            and m."owner_type" = 'core'
            and m."deleted_at" is null
        );
    `)
  }

  /**
   * Drops only what this migration created. `design.moodboard` is untouched
   * on the way down because it was never moved — every backfilled scene is
   * still in the column it was copied from, so a rollback loses nothing.
   */
  override async down(): Promise<void> {
    this.addSql(`drop table if exists "design_moodboard" cascade;`)
  }
}
