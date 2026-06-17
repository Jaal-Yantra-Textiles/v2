/**
 * Unit tests for the visual-flows `bulk_update_data` operation — specifically
 * the `items` template-resolution contract.
 *
 * The regression this guards: `items` is configured as a template string
 * (e.g. "{{ classify.update_items }}") that must resolve to an array of
 * { selector, data } records. The operation used to guard on
 * `Array.isArray(options.items)` BEFORE interpolating, so a string template
 * was discarded as `[]` and every update became a silent no-op — the cart
 * recovery flow's `mark_sent` never stamped `recovery_email_sent_at`, so the
 * resend-gap + send-cap never engaged and carts were re-emailed hourly.
 *
 * The operation only reads `context.container` + `context.dataChain`, so we can
 * invoke it directly without booting Medusa.
 */

import { bulkUpdateDataOperation } from "../bulk-update-data"

function makeContext(dataChain: Record<string, any>, service: any): any {
  return {
    container: {
      resolve: (name: string) => (name === "cart" ? service : null),
    } as any,
    dataChain: {
      $trigger: { payload: {}, timestamp: "2026-06-17T00:00:00.000Z" },
      $accountability: {},
      $env: {},
      $last: null,
      ...dataChain,
    },
    flowId: "flow_test",
    executionId: "exec_test",
    operationId: "op_test",
    operationKey: "mark_sent",
  }
}

describe("bulk_update_data operation — items resolution", () => {
  const UPDATE_ITEMS = [
    {
      selector: { id: "cart_123" },
      data: { metadata: { recovery_email_sent_at: "2026-06-17T13:00:00.000Z" } },
    },
  ]

  it("resolves a template-string `items` into the upstream array and updates each record", async () => {
    const updateCarts = jest.fn().mockResolvedValue({ id: "cart_123" })
    const service = { updateCarts }

    const result = await bulkUpdateDataOperation.execute(
      {
        module: "cart",
        collection: "carts",
        // The real flow passes a template string here, NOT a literal array.
        items: "{{ classify.update_items }}",
        continue_on_error: true,
        max_items: 500,
      },
      makeContext({ classify: { update_items: UPDATE_ITEMS } }, service),
    )

    expect(result.success).toBe(true)
    expect(result.data?.updated).toBe(1)
    expect(result.data?.failed).toBe(0)
    // selector.id present → called positionally with (id, data)
    expect(updateCarts).toHaveBeenCalledWith("cart_123", {
      metadata: { recovery_email_sent_at: "2026-06-17T13:00:00.000Z" },
    })
  })

  it("still accepts a literal array `items`", async () => {
    const updateCarts = jest.fn().mockResolvedValue({ id: "cart_123" })
    const service = { updateCarts }

    const result = await bulkUpdateDataOperation.execute(
      {
        module: "cart",
        collection: "carts",
        items: UPDATE_ITEMS,
        continue_on_error: true,
        max_items: 500,
      },
      makeContext({}, service),
    )

    expect(result.success).toBe(true)
    expect(result.data?.updated).toBe(1)
    expect(updateCarts).toHaveBeenCalledTimes(1)
  })

  it("errors clearly when `items` does not resolve to an array", async () => {
    const service = { updateCarts: jest.fn() }

    const result = await bulkUpdateDataOperation.execute(
      {
        module: "cart",
        collection: "carts",
        items: "{{ classify.does_not_exist }}",
        continue_on_error: true,
        max_items: 500,
      },
      makeContext({ classify: { update_items: UPDATE_ITEMS } }, service),
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/did not resolve to an array/i)
    expect(service.updateCarts).not.toHaveBeenCalled()
  })
})
