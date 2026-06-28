import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `ai_generate` to the visual_flow_operation.operation_type CHECK
 * constraint. The new operation is implemented at
 * `src/modules/visual_flows/operations/ai-generate.ts` — general-purpose AI
 * text generation that resolves the model from the admin-configured External
 * Platform for a role (category=ai), with free-model fallback.
 *
 * Without this migration, inserting a flow operation row with
 * operation_type='ai_generate' fails the CHECK and rolls back the write.
 * Idempotent ALTER (drop-if-exists → re-add); never edits the create-table.
 */
export class Migration20260628120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'bulk_update_data', 'bulk_create_data', 'bulk_http_request', 'bulk_trigger_workflow', 'http_request', 'run_script', 'send_email', 'send_whatsapp', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log', 'ai_extract', 'ai_extract_platform', 'ai_generate', 'aggregate_product_analytics', 'generate_partner_deeplink', 'wait_for_event'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'bulk_update_data', 'bulk_create_data', 'bulk_http_request', 'bulk_trigger_workflow', 'http_request', 'run_script', 'send_email', 'send_whatsapp', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log', 'ai_extract', 'ai_extract_platform', 'aggregate_product_analytics', 'generate_partner_deeplink', 'wait_for_event'));`);
  }

}
