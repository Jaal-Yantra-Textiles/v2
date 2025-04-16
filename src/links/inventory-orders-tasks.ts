import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import TasksModule from "../modules/tasks";


/**
 * Links each inventory order line to multiple tasks.
 * This enables loose coupling between order lines and inventory items and tasks across modules.
 */
export default defineLink(
  InventoryOrdersModule.linkable.inventoryOrders,
  {
    linkable: TasksModule.linkable.task,
    isList: true, // Each order line links to many tasks
    field: 'tasks'
  }
);
