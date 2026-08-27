import { ShiprocketClient } from "../client"
import { createShiprocketStubFetch } from "../stub-fetch"

/**
 * #1576 — the Shiprocket stub can answer a tracking lookup.
 *
 * Two `partner-shipment-carrier-modal` e2e cases were parked as "stale
 * selectors". They were not: `POST /partners/orders/:id/shiprocket-attach-awb`
 * calls `provider.track({ awb })` against the LIVE API and throws twice over —
 * once if the lookup fails, again if Shiprocket returns no shipment. The spec
 * attaches a synthetic `E2E<timestamp>` waybill, so those cases could not pass
 * ANYWHERE, credentials or not.
 *
 * The deterministic transport (`SHIPROCKET_STUB=1`) already existed but had no
 * `/courier/track/awb/:awb` handler, so it 404'd the lookup and the client
 * threw exactly as the live API would.
 *
 * 🔑 This proves the BACKEND half locally, so the only thing left to CI is the
 * browser flow. Asserting the e2e green without this would be betting on two
 * unverified halves at once.
 *
 * ⚠️ It lives beside the code it tests, under a `__tests__` directory with a
 * `.unit.spec.ts` suffix, deliberately. Written first into
 * `integration-tests/http/`, it matched NEITHER jest config and jest reported
 * "No tests found" — a file that exists, looks like coverage, and never runs.
 *
 * (And do not write that testMatch glob out in a block comment: the `*` `*` `/`
 * in it terminates the comment early and the prose below becomes code.)
 */
describe("Shiprocket stub — tracking lookup (#1576)", () => {
  const client = () =>
    new ShiprocketClient({
      email: "test@shiprocket.example",
      password: "secret",
      // 🔴 The export is a FACTORY. Importing a non-existent name gave
      // `undefined`, the client silently fell back to `globalThis.fetch`, and
      // the failure was a REAL 403 from Shiprocket — a test that looked like it
      // was exercising the stub while talking to the live API.
      fetchImpl: createShiprocketStubFetch(),
    } as any)

  it("answers a track for an arbitrary AWB, so a synthetic waybill resolves", async () => {
    const awb = `E2E${Date.now()}`
    const tracking = await client().track({ awb })

    // 🔑 It echoes the AWB it was ASKED about. A constant would let a route
    // that ignores its input pass this test.
    expect(tracking.awb).toBe(awb)
    expect(tracking.current_status).toBeTruthy()
    expect(tracking.events.length).toBeGreaterThan(0)
  })

  it("satisfies the guard the attach route applies", async () => {
    // `attachExistingShiprocketAwb` rejects a lookup that returns no shipment:
    //   hasShipment = tracking.awb || tracking.current_status || events.length
    // Assert that predicate directly — it is the thing that was throwing.
    const tracking = await client().track({ awb: "E2E-GUARD" })
    const hasShipment =
      !!tracking &&
      (!!tracking.awb ||
        !!tracking.current_status ||
        (tracking.events || []).length > 0)
    expect(hasShipment).toBe(true)

    // And the shape the route reads its provider refs from.
    expect((tracking.raw as any)?.shipment_track?.[0]?.awb).toBe("E2E-GUARD")
  })
})
