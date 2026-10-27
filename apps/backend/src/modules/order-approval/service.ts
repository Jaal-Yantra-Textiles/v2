import { MedusaService } from "@medusajs/framework/utils"
import OrderApproval from "./models/order-approval"

class OrderApprovalService extends MedusaService({
  OrderApproval,
}) {
  /**
   * 🔴 Refuses an empty hash. An undefined filter value means NO filter, and
   * would hand back the first approval of anybody's order.
   */
  async findByTokenHash(tokenHash: string) {
    if (!tokenHash) return null
    const rows = await this.listOrderApprovals({ token_hash: tokenHash })
    return rows?.[0] || null
  }

  async listForOrder(orderId: string) {
    if (!orderId) return []
    return await this.listOrderApprovals(
      { order_id: orderId },
      { order: { created_at: "DESC" } }
    )
  }
}

export default OrderApprovalService
