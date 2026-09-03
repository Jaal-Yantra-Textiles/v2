import DtdcFulfillmentService from "../providers/dtdc/service"

/**
 * #1422 — a calculated DTDC option quoted FREE shipping.
 *
 * `canCalculate` returned `true` and `calculatePrice` returned
 * `{ calculated_amount: 0 }`, on an integration with no rate API at all
 * (`carrier-capabilities.ts` records dtdc as `can_rate: false`). A zero is
 * indistinguishable from a genuinely free lane, so nothing downstream could
 * tell "we cannot quote" from "shipping is free" — and the buyer was charged
 * nothing to ship.
 *
 * These two cases are the whole contract, and the second one is deliberately
 * NOT an amount assertion: asserting any number here would be re-asserting the
 * bug in a different denomination.
 */
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as any

const service = () =>
  new (DtdcFulfillmentService as any)(
    { logger },
    {
      customer_code: "GL018",
      api_key: "test-key",
      tracking_username: "GL018_trk_json",
      tracking_password: "test",
    }
  )

describe("DtdcFulfillmentService — calculated pricing (#1422)", () => {
  it("refuses to back a calculated shipping option", async () => {
    // This is what stops a calculated dtdc option being created in the first
    // place. DTDC has no rate API; there is nothing to calculate from.
    await expect(service().canCalculate({} as any)).resolves.toBe(false)
  })

  it("throws rather than quoting a price it cannot know", async () => {
    // Reachable only through an option created before this fix. A number here
    // — zero or any invented flat rate — is a price nobody chose, shown to a
    // buyer as though a carrier had said it.
    await expect(
      service().calculatePrice({}, {}, {})
    ).rejects.toThrow(/no rate API/i)
  })

  it("never resolves to an amount", async () => {
    // Guards the guard: a future 'helpful' fallback that returns a number
    // reintroduces exactly the defect, and a rejects-toThrow test alone would
    // still catch it — but only if someone remembers what it was for.
    const result = await service()
      .calculatePrice({}, {}, {})
      .then(
        (v: any) => ({ resolved: true, v }),
        () => ({ resolved: false, v: undefined })
      )
    expect(result.resolved).toBe(false)
  })
})
