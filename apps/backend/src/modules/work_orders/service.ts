import { MedusaService } from "@medusajs/framework/utils"
import WorkOrder from "./models/work-order"
import WorkOrderItem from "./models/work-order-item"

class WorkOrderService extends MedusaService({ WorkOrder, WorkOrderItem }) {}

export default WorkOrderService
