import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `ai_extract_platform` to the visual_flow_operation.operation_type
 * CHECK constraint. The new operation is implemented at
 * `src/modules/visual_flows/operations/ai-extract-platform.ts` and reads
 * provider / api_key / model from admin-configured External Platforms
 * (category=ai) instead of hardcoding them in flow definitions.
 *
 * Without this migration, inserting a flow operation row with
 * operation_type='ai_extract_platform' fails the CHECK and rolls back
 * the seed.
 */
export class Migration20260531000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'bulk_update_data', 'bulk_create_data', 'bulk_http_request', 'bulk_trigger_workflow', 'http_request', 'run_script', 'send_email', 'send_whatsapp', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log', 'ai_extract', 'ai_extract_platform', 'aggregate_product_analytics', 'generate_partner_deeplink'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'bulk_update_data', 'bulk_create_data', 'bulk_http_request', 'bulk_trigger_workflow', 'http_request', 'run_script', 'send_email', 'send_whatsapp', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log', 'ai_extract', 'aggregate_product_analytics', 'generate_partner_deeplink'));`);
  }

}
