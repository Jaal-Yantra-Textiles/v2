import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1939 — create `platform_cost_config` and seed the policy currently compiled
 * into the code, so the table's first row states today's behaviour exactly.
 *
 * Hand-written `create table if not exists` rather than a generated migration,
 * so it lands cleanly on databases that already exist. The seed is idempotent
 * (`on conflict (id) do nothing`) with a deterministic id, so re-runs are no-ops.
 *
 * 🔴 The seeded numbers are the ones in the code TODAY, not the ones we think
 * are right. Seeding an improved number here would make the config disagree with
 * every compiled fallback on day one and change prices as a side effect of a
 * migration. Policy changes are a later INSERT with a new `effective_from`,
 * which is the whole point of the table being effective-dated.
 *
 *   platform_fee_percent          10    <- estimate-design-cost.ts DEFAULT_PLATFORM_FEE_PERCENT
 *   production_overhead_percent   30    <- estimate-design-cost.ts DEFAULT_PRODUCTION_PERCENT
 *   default_material_cost         600   <- estimate-design-cost.ts DEFAULT_MATERIAL_COST (INR)
 *   custom_design_markup_percent  20    <- partner-quote/lib/design-quote-price.ts
 *   approval_markup_multiplier    1.4   <- production-runs/approval-pricing.ts APPROVAL_MARKUP
 *
 * `effective_from` is backdated to 2025-01-01 so the first row covers every
 * price already computed under these constants — a row effective from today
 * would leave all prior history resolving to "no policy".
 */
export class Migration20260909120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "platform_cost_config" (
      "id" text not null,
      "effective_from" timestamptz not null,
      "notes" text null,
      "is_active" boolean not null default true,
      "platform_fee_percent" real null,
      "production_overhead_percent" real null,
      "default_material_cost" real null,
      "default_material_cost_currency" text null,
      "custom_design_markup_percent" real null,
      "approval_markup_multiplier" real null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "platform_cost_config_pkey" primary key ("id")
    );`);

    this.addSql(`create index if not exists "IDX_platform_cost_config_deleted_at" on "platform_cost_config" ("deleted_at") where "deleted_at" is null;`);

    this.addSql(`create index if not exists "IDX_platform_cost_config_effective_from" on "platform_cost_config" ("effective_from") where "deleted_at" is null;`);

    this.addSql(`insert into "platform_cost_config"
      ("id", "effective_from", "notes", "is_active",
       "platform_fee_percent", "production_overhead_percent",
       "default_material_cost", "default_material_cost_currency",
       "custom_design_markup_percent", "approval_markup_multiplier")
      values (
        'pcc_initial',
        '2025-01-01T00:00:00Z',
        'Initial row: the constants compiled into the code as of #1939. Not a policy change — a statement of what was already true.',
        true,
        10,
        30,
        600,
        'INR',
        20,
        1.4
      )
      on conflict ("id") do nothing;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "platform_cost_config";`);
  }
}
