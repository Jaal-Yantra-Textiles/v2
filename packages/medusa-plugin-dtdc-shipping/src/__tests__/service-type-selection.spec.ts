import { DtdcProviderAdapter } from "../providers/dtdc/adapter"
import type { CreateShipmentInput } from "../lib/provider-interface"

/**
 * Who picks the DTDC service.
 *
 * The adapter used to return one of two HARDCODED values from a weight
 * heuristic, unconditionally. That meant `default_service_type` had no effect
 * on this path and a caller could not choose at all — and the two values are
 * the SANDBOX products. A live B2C account lists `B2C PRIORITY` and does not
 * list bare `PRIORITY`, so the heuristic could send a service the account does
 * not have, refused at booking rather than at configuration.
 */
const baseInput = (over: Partial<CreateShipmentInput> = {}): CreateShipmentInput =>
  ({
    reference_id: "ord_1",
    payment_mode: "prepaid",
    pickup_location_name: "WH-1",
    to: {
      name: "Buyer",
      phone: "9999999999",
      address_1: "1 Road",
      city: "Delhi",
      state: "Delhi",
      pincode: "110042",
    },
    items: [],
    weight_grams: 500,
    ...over,
  }) as CreateShipmentInput

/** Capture what the adapter asks the carrier for, without a network. */
function captureServiceType(
  options: any,
  input: CreateShipmentInput
): string | undefined {
  const adapter = new DtdcProviderAdapter({
    customer_code: "CC",
    api_key: "k",
    ...options,
  })
  let seen: any
  ;(adapter as any).client = {
    createShipment: async (p: any) => {
      seen = p.service_type_id
      return { awb_number: "A1", reference_number: "ord_1" }
    },
  }
  return (adapter as any)
    .createShipment(input)
    .then(() => seen)
    .catch(() => seen)
}

describe("DTDC service-type selection", () => {
  it("uses the CALLER's choice above everything else", async () => {
    const seen = await captureServiceType(
      { default_service_type: "B2C GROUND ECONOMY" },
      baseInput({ preferred_courier_id: "B2C PREMIUM" } as any)
    )
    expect(seen).toBe("B2C PREMIUM")
  })

  it("accepts the caller's choice by name, separators and case aside", async () => {
    const seen = await captureServiceType(
      {},
      baseInput({ preferred_courier_id: "b2c_smart_express" } as any)
    )
    expect(seen).toBe("B2C SMART EXPRESS")
  })

  /**
   * 🔴 The regression that mattered: a configured default was silently
   * overridden by the heuristic. Deferring means `undefined` reaches the
   * client, which applies the configured value.
   */
  it("defers to the configured default instead of guessing", async () => {
    const seen = await captureServiceType(
      { default_service_type: "B2C PRIORITY" },
      baseInput({ weight_grams: 25000 })
    )
    expect(seen).toBeUndefined()
  })

  it("falls back to the weight heuristic only when nothing is configured", async () => {
    expect(await captureServiceType({}, baseInput({ weight_grams: 25000 }))).toBe(
      "GROUND_EXPRESS"
    )
    expect(await captureServiceType({}, baseInput({ weight_grams: 500 }))).toBe(
      "PRIORITY"
    )
  })

  it("ignores an unrecognised caller choice rather than forwarding a typo", async () => {
    const seen = await captureServiceType(
      {},
      baseInput({
        preferred_courier_id: "B2C SUPER EXPRESS",
        weight_grams: 500,
      } as any)
    )
    expect(seen).toBe("PRIORITY")
  })
})
