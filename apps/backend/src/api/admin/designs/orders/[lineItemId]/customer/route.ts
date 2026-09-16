import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../../../links/design-line-item-link"
import designCustomerLink from "../../../../../../links/design-customer-link"
import designOrderLink from "../../../../../../links/design-order-link"
import { DESIGN_MODULE } from "../../../../../../modules/designs"
import { decideCustomerAttach } from "../../mutate-design-order"

/**
 * POST /admin/designs/orders/:lineItemId/customer
 *
 * Attach (or detach) the buyer of an EXISTING design order.
 *
 * Until this route existed a design order created without a customer stayed
 * without one forever: the buyer was fixed when the cart was created, and no
 * admin route could mutate a cart — Medusa's cart mutations are store-side.
 * The admin screen offered no attach action because there was nothing to call.
 * #1970 PR5.
 *
 * 🔴 It writes BOTH the cart and the design↔customer link. The detail route
 * reads the link first and `cart.customer_id` second, so writing one alone
 * leaves a design order that reads as owned on screen and checks out
 * anonymous, or the reverse. `decideCustomerAttach` holds that rule and is
 * unit-tested without a container.
 *
 * Body: `{ customer_id: string | null }` — null detaches.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const { lineItemId } = req.params
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const cartService = req.scope.resolve(Modules.CART) as any
    const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

    const rawCustomerId = (req.body as { customer_id?: unknown } | undefined)
      ?.customer_id
    if (rawCustomerId !== null && typeof rawCustomerId !== "string") {
      res.status(400).json({
        message:
          "customer_id must be a customer id, or null to detach the buyer.",
      })
      return
    }
    const customerId = typeof rawCustomerId === "string" ? rawCustomerId.trim() : null

    // 1. The design behind this line.
    const { data: linkRows } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { line_item_id: lineItemId },
      fields: ["design_id", "line_item_id"],
    })
    if (!linkRows?.length) {
      res.status(404).json({ message: "Design order not found" })
      return
    }
    const designId = linkRows[0].design_id

    // 2. The cart this line sits on.
    const [lineItem] = await cartService.listLineItems(
      { id: lineItemId },
      { select: ["id", "cart_id", "unit_price"] }
    )
    const cart = lineItem?.cart_id
      ? await cartService
          .retrieveCart(lineItem.cart_id, {
            select: ["id", "customer_id", "email", "completed_at"],
          })
          .catch(() => null)
      : null

    /**
     * 3. The customer must EXIST.
     *
     * 🔴 Guarded on presence before the read: `filters: { id: undefined }` is
     * not "no rows" — an absent filter matches everything, and the first row
     * back would attach a stranger to somebody's order. The same trap the cart
     * creation step documents.
     */
    let customer: { id: string; email?: string | null } | null = null
    if (customerId) {
      const { data: customers } = await query.graph({
        entity: "customer",
        filters: { id: customerId },
        fields: ["id", "email"],
      })
      customer = customers?.[0] ?? null
      if (!customer) {
        res.status(404).json({ message: `Customer ${customerId} does not exist.` })
        return
      }
    }

    // 4. Who is linked to this design today.
    const { data: existingLinks = [] } = await query
      .graph({
        entity: designCustomerLink.entryPoint,
        filters: { design_id: designId },
        fields: ["design_id", "customer_id"],
      })
      .catch(() => ({ data: [] }))

    /** See the reprice route: completed_at alone does not say "converted". */
    const { data: orderLinks = [] } = await query
      .graph({
        entity: designOrderLink.entryPoint,
        filters: { design_id: designId },
        fields: ["order_id"],
      })
      .catch(() => ({ data: [] }))

    const decision = decideCustomerAttach({
      designId,
      cart,
      hasLinkedOrder: (orderLinks as any[]).some((l) => l?.order_id),
      linkedCustomerIds: (existingLinks as any[])
        .map((l) => l?.customer_id)
        .filter(Boolean),
      customer,
    })

    if (!decision.ok) {
      res
        .status(decision.reason === "cart_completed" ? 409 : 404)
        .json({ message: decision.message, reason: decision.reason })
      return
    }

    if (decision.noop) {
      res.status(200).json({
        design_order_customer: {
          design_id: designId,
          cart_id: cart!.id,
          customer_id: decision.cart.customer_id,
          changed: false,
        },
      })
      return
    }

    /**
     * 5. Write the cart FIRST.
     *
     * If the link write then fails, the detail route still resolves the buyer
     * through its `cart.customer_id` fallback, so the order is recoverable and
     * reads correctly. The reverse order would leave a link with no buyer on
     * the cart — which reads as owned and checks out anonymous, the exact
     * split this route exists to avoid.
     */
    await cartService.updateCarts(cart!.id, {
      customer_id: decision.cart.customer_id,
      email: decision.cart.email,
    })

    if (decision.dismiss.length) {
      await remoteLink.dismiss(
        decision.dismiss.map((d) => ({
          [DESIGN_MODULE]: { design_id: d.design_id },
          [Modules.CUSTOMER]: { customer_id: d.customer_id },
        }))
      )
    }

    if (decision.link) {
      await remoteLink.create([
        {
          [DESIGN_MODULE]: { design_id: decision.link.design_id },
          [Modules.CUSTOMER]: { customer_id: decision.link.customer_id },
        },
      ])
    }

    res.status(200).json({
      design_order_customer: {
        design_id: designId,
        cart_id: cart!.id,
        customer_id: decision.cart.customer_id,
        email: decision.cart.email,
        changed: true,
        dismissed_customer_ids: decision.dismiss.map((d) => d.customer_id),
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[admin] attaching a customer to design order ${req.params.lineItemId} failed: ${
        e?.message ?? e
      }`
    )
    res.status(500).json({
      message: "Failed to attach the customer to this design order.",
    })
  }
}
