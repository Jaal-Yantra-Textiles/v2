import Line_fulfillment from "./models/line_fulfillment";
import InventoryShipment from "./models/inventory_shipment";
import GoodsTransfer from "./models/goods_transfer";
import { MedusaService } from "@medusajs/framework/utils";

class Fullfilled_ordersService extends MedusaService({
  Line_fulfillment,
  InventoryShipment,
  GoodsTransfer,
}) {
  constructor() {
    super(...arguments)
  }
  
  async listLineFulfillments(selector?: any, config?: any) {
    // Forward to the auto-generated method based on the registered model key `Line_fulfillment`
    // Ensure argument shape matches MedusaService list(signature: selector?, config?)
    return (this as any).listLine_fulfillments(selector ?? {}, config ?? {})
  }
}

export default Fullfilled_ordersService;
