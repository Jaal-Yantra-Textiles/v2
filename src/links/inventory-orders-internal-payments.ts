import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import InternalPaymentModule from "../modules/internal_payments";


/**
 * Links each inventory order line to a many payments item.
 * This enables loose coupling between order lines and inventory items across modules.
 */
export default defineLink(
  InventoryOrdersModule.linkable.inventoryOrders,
  {
    linkable: InternalPaymentModule.linkable.internalPayments,
    isList: true, // Each order line links to many payment item
  }
);
