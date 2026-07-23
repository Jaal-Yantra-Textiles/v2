import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `run_maintenance_job` to the visual_flow_operation.operation_type CHECK
 * constraint. The new operation is implemented at
 * `src/modules/visual_flows/operations/run-maintenance-job.ts` — it runs any
 * registered Data-Plumbing maintenance job in-process, so a scheduled flow can
 * periodically apply job logic (winback target generation, backfills, recomputes).
 *
 * Without this migration, inserting a flow operation row with
 * operation_type='run_maintenance_job' fails the CHECK and rolls back the seed.
 *
 * The whitelist below is the FULL set of currently-registered operation types
 * (see operations/index.ts registerBuiltInOperations) plus run_maintenance_job —
 * deliberately a SUPERSET of the prior constraint so this ALTER can only widen,
 * never narrow (narrowing would newly reject already-registered ops such as the
 * marketing/analytics nodes). Idempotent ALTER (drop-if-exists → re-add).
 */
export class Migration20260712120000 extends Migration {

  private static readonly ALL_OPS = [
    "condition", "create_data", "read_data", "update_data", "delete_data",
    "bulk_update_data", "bulk_create_data", "bulk_http_request",
    "bulk_trigger_workflow", "http_request", "run_script", "send_email",
    "send_whatsapp", "notification", "transform", "trigger_workflow",
    "trigger_flow", "execute_code", "sleep", "log", "ai_extract",
    "ai_extract_platform", "ai_generate", "aggregate_product_analytics",
    "generate_partner_deeplink", "wait_for_event", "aggregate_data",
    "time_series", "cart_recovery_stats", "resolve_cart_recovery_urls",
    "marketing_daily_ideas_email", "partner_analytics_digest", "gmv_projection",
    "commission_projection", "ads_efficiency", "run_maintenance_job",
  ]

  private buildCheck(ops: string[]): string {
    const list = ops.map((o) => `'${o}'`).join(", ")
    return `alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in (${list}));`
  }

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);
    this.addSql(this.buildCheck(Migration20260712120000.ALL_OPS));
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);
    // Restore without run_maintenance_job (still a superset of the prior list).
    this.addSql(
      this.buildCheck(
        Migration20260712120000.ALL_OPS.filter((o) => o !== "run_maintenance_job")
      )
    );
  }

}
