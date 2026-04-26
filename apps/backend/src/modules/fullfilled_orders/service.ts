import Line_fulfillment from "./models/line_fulfillment";
import { MedusaService } from "@medusajs/framework/utils";
// Import your models here, e.g.:
// import MyModel from "./models/MyModel";

class Fullfilled_ordersService extends MedusaService({
  Line_fulfillment,
  // Register your models here, e.g.:
  // MyModel,
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
