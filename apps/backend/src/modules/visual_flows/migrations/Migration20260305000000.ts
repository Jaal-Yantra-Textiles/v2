import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260305000000 extends Migration {

  override async up(): Promise<void> {
    // Drop the stale constraint and replace it with one that includes all
    // currently registered operation types: ai_extract, bulk_update_data,
    // and aggregate_product_analytics were missing and caused INSERT failures.
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'bulk_update_data', 'http_request', 'run_script', 'send_email', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log', 'ai_extract', 'aggregate_product_analytics'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'http_request', 'run_script', 'send_email', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log'));`);
  }

}
