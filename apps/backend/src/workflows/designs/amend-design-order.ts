import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../links/design-line-item-link"
import { DESIGN_MODULE } from "../../modules/designs"
import {
  convertEstimateCurrencyStep,
  DesignEstimate,
  estimateDesignCostsStep,
  linkDesignsToLineItemsStep,
} from "./create-draft-order-from-designs"

/**
 * Add designs to, and/or take lines off, an UNPAID design order's cart.
 *
 * The caller (`POST /admin/designs/orders/:lineItemId/items`) has already run
 * `decideAmend`, so this only writes. Prices come from the same two steps the
 * create workflow uses — the design's estimate, or an override — converted
 * into the cart's own currency, so an added line is priced exactly as it would
 * have been had it been on the order from the start.
 *
 * Tax lines and the checkout's payment collection are NOT handled here: the
 * route recomputes both afterwards, once, for the final set of lines.
 */
type AmendDesignOrderInput = {
  cart_id: string
  currency_code: string
  add_design_ids: string[]
  remove_line_item_ids: string[]
  price_overrides?: Record<string, number>
  /** Currency of `price_overrides`. Defaults to the cart's own currency. */
  override_currency?: string
}

const addDesignLinesStep = createStep(
  "amend-design-order-add-lines",
  async (input: { cart_id: string; estimates: DesignEstimate[] }, { container }) => {
    if (!input.estimates?.length) {
      return new StepResponse({ lineItems: [] as any[] }, [] as string[])
    }
    const cartService = container.resolve(Modules.CART) as any
    // Same shape as `createDesignCartStep` — see the comments there for why
    // `requires_shipping` stays false on the cart and `thumbnail` is snapshotted.
    const lineItems = await cartService.addLineItems(
      input.cart_id,
      input.estimates.map((est) => ({
        title: est.name,
        thumbnail: est.thumbnail ?? null,
        unit_price: est.unit_price,
        is_custom_price: true,
        requires_shipping: false,
        quantity: 1,
        metadata: {
          design_id: est.design_id,
          cost_confidence: est.confidence,
          added_by_amend: true,
          ...(est.original_price != null && {
            original_currency: est.original_currency,
            original_amount: est.original_price,
          }),
        },
      }))
    )
    return new StepResponse(
      { lineItems },
      (lineItems ?? []).map((li: any) => li.id)
    )
  },
  async (ids, { container }) => {
    if (!ids?.length) return
    const cartService = container.resolve(Modules.CART) as any
    await cartService.deleteLineItems(ids).catch(() => undefined)
  }
)

const removeDesignLinesStep = createStep(
  "amend-design-order-remove-lines",
  async (input: { remove_line_item_ids: string[] }, { container }) => {
    if (!input.remove_line_item_ids?.length) {
      return new StepResponse({ removed: [] as string[] }, null)
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
    const cartService = container.resolve(Modules.CART) as any

    const { data: links = [] } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { line_item_id: input.remove_line_item_ids },
      fields: ["design_id", "line_item_id"],
    })
    const dismissed = (links as any[]).map((l) => ({
      [DESIGN_MODULE]: { design_id: l.design_id },
      [Modules.CART]: { line_item_id: l.line_item_id },
    }))
    if (dismissed.length) await remoteLink.dismiss(dismissed)

    // Soft delete — the line stays in the database as the record of what was
    // offered, the same reason a cancel is a stamp and not a removal.
    await cartService.softDeleteLineItems(input.remove_line_item_ids)

    return new StepResponse(
      { removed: input.remove_line_item_ids },
      { ids: input.remove_line_item_ids, dismissed }
    )
  },
  async (comp, { container }) => {
    if (!comp?.ids?.length) return
    const cartService = container.resolve(Modules.CART) as any
    await cartService.restoreLineItems(comp.ids).catch(() => undefined)
    if (comp.dismissed?.length) {
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create(comp.dismissed).catch(() => undefined)
    }
  }
)

export const amendDesignOrderWorkflow = createWorkflow(
  "amend-design-order",
  (input: AmendDesignOrderInput) => {
    const estimates = estimateDesignCostsStep({
      design_ids: input.add_design_ids,
      price_overrides: input.price_overrides,
      override_currency: input.override_currency,
    })

    const converted = convertEstimateCurrencyStep({
      estimates: estimates.estimates as unknown as DesignEstimate[],
      target_currency: input.currency_code,
    })

    const added = addDesignLinesStep({
      cart_id: input.cart_id,
      estimates: converted.estimates as unknown as DesignEstimate[],
    })

    linkDesignsToLineItemsStep({
      estimates: converted.estimates as unknown as DesignEstimate[],
      lineItems: added.lineItems,
    })

    const removed = removeDesignLinesStep({
      remove_line_item_ids: input.remove_line_item_ids,
    })

    return new WorkflowResponse({ added: added.lineItems, removed: removed.removed })
  }
)

export default amendDesignOrderWorkflow
