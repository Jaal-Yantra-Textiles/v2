/**
 * #1920 item 3 — "do not produce" is an EXPLICIT flag, not the accident of a
 * missing `product_id`.
 *
 * Three halves have to agree, so all three are exercised here:
 *   1. the WRITER  — convert-design-order stamps the veto on every order item;
 *   2. the READERS — both automatic run-creation doors honour it;
 *   3. the helper  — and it only reads as a veto when it really is one.
 */

jest.mock("@medusajs/medusa/core-flows", () => ({
  convertDraftOrderWorkflow: jest.fn(() => ({ run: jest.fn(async () => ({ result: {} })) })),
  createOrderPaymentCollectionWorkflow: jest.fn(() => ({
    run: jest.fn(async () => ({ result: { id: "paycol_1" } })),
  })),
  createOrderWorkflow: jest.fn(),
  markPaymentCollectionAsPaid: jest.fn(() => ({ run: jest.fn(async () => ({ result: {} })) })),
}))

import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import { convertDesignOrderToOrder } from "../convert-design-order"
import {
  NO_AUTO_PRODUCE_METADATA_KEY,
  isAutoProduceSuppressed,
} from "../../../lib/resolve-line-item-production"
import { planLineItemRunAction } from "../../../lib/plan-fulfillment-production-runs"

const CART = {
  id: "cart_1",
  region_id: "reg_1",
  currency_code: "inr",
  sales_channel_id: "sc_1",
  customer_id: "cus_1",
  email: "buyer@example.com",
  completed_at: null,
  metadata: {},
  shipping_address: { first_name: "A", address_1: "1 St", city: "Bhuj", country_code: "in" },
  billing_address: null,
  items: [
    {
      id: "li_1",
      title: "Ajrakh Jacket",
      quantity: 2,
      unit_price: 4500,
      metadata: { design_id: "des_1", cost_confidence: "high" },
    },
  ],
}

const buildContainer = () => {
  const cartService = {
    listLineItems: jest.fn(async () => [{ id: "li_1", cart_id: "cart_1" }]),
    updateCarts: jest.fn(async () => ({})),
  }
  const query = {
    graph: jest.fn(async ({ entity }: any) =>
      entity === "cart" ? { data: [CART] } : { data: [{ design_id: "des_1", line_item_id: "li_1" }] }
    ),
  }
  const remoteLink = { create: jest.fn(async () => ({})) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const registry: Record<string, any> = {
    logger,
    query,
    link: remoteLink,
    cart: cartService,
    order: { updateOrders: jest.fn(async () => ({})) },
  }
  return {
    resolve: jest.fn((key: string) => registry[key]),
  } as any
}

describe("#1920 — the writer stamps an explicit no-auto-produce veto", () => {
  beforeEach(() => jest.clearAllMocks())

  it("puts no_auto_produce on EVERY converted order item, alongside the design metadata", async () => {
    ;(createOrderWorkflow as unknown as jest.Mock).mockReturnValue({
      run: jest.fn(async () => ({
        result: { id: "order_1", display_id: 42, status: "draft", payment_status: "captured" },
      })),
    })

    await convertDesignOrderToOrder(buildContainer(), {
      lineItemId: "li_1",
      paymentMode: "cod",
    })

    // Assert AFTER the call, on what the real code handed to core.
    const runMock = (createOrderWorkflow as unknown as jest.Mock).mock.results[0].value.run
    const items = runMock.mock.calls[0][0].input.items

    expect(items).toHaveLength(1)
    expect(items[0].metadata[NO_AUTO_PRODUCE_METADATA_KEY]).toBe(true)
    expect(items[0].metadata.no_auto_produce_reason).toBe("design-order-convert")
    // and the veto did not cost us the design provenance it travels with
    expect(items[0].metadata.design_id).toBe("des_1")
    expect(isAutoProduceSuppressed(items[0].metadata)).toBe(true)
  })
})

describe("#1920 — the automatic fulfillment door honours the veto", () => {
  const query = { graph: jest.fn() }

  it("does NOT create a provenance run for a vetoed item, even with a product_id", async () => {
    // No existing run for this line item …
    query.graph = jest.fn(async () => ({ data: [] }))

    const action = await planLineItemRunAction(query, {
      lineItemId: "li_1",
      productId: "prod_1",
      quantity: 1,
      metadata: { [NO_AUTO_PRODUCE_METADATA_KEY]: true },
    })

    expect(action).toBeNull()
  })

  it("still COMPLETES an existing pre-production run on a vetoed item — the veto blocks creation only", async () => {
    query.graph = jest.fn(async () => ({
      data: [{ id: "prun_1", status: "draft", produced_quantity: null, design_id: "des_1", metadata: {} }],
    }))

    const action = await planLineItemRunAction(query, {
      lineItemId: "li_1",
      productId: "prod_1",
      quantity: 1,
      metadata: { [NO_AUTO_PRODUCE_METADATA_KEY]: true },
    })

    expect(action?.action).toBe("complete")
    expect((action as any).production_run_id).toBe("prun_1")
  })

  it("still CREATES for the same item once the veto is absent (the veto is what stops it)", async () => {
    query.graph = jest.fn(async () => ({ data: [] }))

    const action = await planLineItemRunAction(query, {
      lineItemId: "li_1",
      productId: "prod_1",
      quantity: 1,
      metadata: { design_id: "des_1" },
    })

    expect(action?.action).toBe("create")
  })
})

describe("#1920 — isAutoProduceSuppressed reads a veto only where one was cast", () => {
  it.each([
    [{ no_auto_produce: true }, true],
    [{ no_auto_produce: "true" }, true],
    [{ no_auto_produce: false }, false],
    [{ no_auto_produce: "false" }, false],
    [{ no_auto_produce: 0 }, false],
    [{ no_auto_produce: "" }, false],
    [{ no_auto_produce: null }, false],
    [{ design_id: "des_1" }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ])("%j → %s", (metadata, expected) => {
    expect(isAutoProduceSuppressed(metadata as any)).toBe(expected)
  })
})
