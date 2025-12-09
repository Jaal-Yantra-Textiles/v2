import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251209011844 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'http_request', 'run_script', 'send_email', 'notification', 'transform', 'trigger_workflow', 'trigger_flow', 'execute_code', 'sleep', 'log'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_operation_type_check";`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_operation_type_check" check("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'http_request', 'run_script', 'send_email', 'notification', 'transform', 'trigger_workflow', 'sleep', 'log'));`);
  }

}
