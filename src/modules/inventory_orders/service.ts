import { MedusaService } from "@medusajs/framework/utils";
import Order from "./models/order";

class InventoryOrderService extends MedusaService({
  Order,
}) {
  constructor() {
    super(...arguments)
  }
}

export default InventoryOrderService;
