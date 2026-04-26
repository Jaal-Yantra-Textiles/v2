import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import TasksModule from "../modules/tasks";


/**
 * Links each inventory order line to multiple tasks.
 * This enables loose coupling between order lines and inventory items and tasks across modules.
 */
export default defineLink(
  { linkable: InventoryOrdersModule.linkable.inventoryOrders, isList: true },
  { linkable: TasksModule.linkable.task, isList: true , field: 'tasks' }
)
