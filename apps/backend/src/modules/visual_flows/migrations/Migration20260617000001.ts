import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #459 P1 — adds `wait_for_event` to the visual_flow_operation.operation_type
 * CHECK constraint so a flow can persist a durable-wait node. The wait's
 * suspend/resume is implemented by the long-running `flowWaitWorkflow`.
 *
 * Mirrors Migration20260531000000: drop + re-add the constraint with the full
 * current type list plus the new value.
 */
export class Migration20260617000001 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'bulk_update_data', 'bulk_create_data', 'bulk_http_request', 'bulk_trigger_workflow', 'http_request', 'run_script', 'send_email', 'send_whatsapp', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log', 'ai_extract', 'ai_extract_platform', 'aggregate_product_analytics', 'generate_partner_deeplink', 'wait_for_event'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'bulk_update_data', 'bulk_create_data', 'bulk_http_request', 'bulk_trigger_workflow', 'http_request', 'run_script', 'send_email', 'send_whatsapp', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log', 'ai_extract', 'ai_extract_platform', 'aggregate_product_analytics', 'generate_partner_deeplink'));`);
  }

}
