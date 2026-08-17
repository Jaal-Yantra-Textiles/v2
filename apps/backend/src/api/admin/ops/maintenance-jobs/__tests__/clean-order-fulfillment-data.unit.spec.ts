import {
  buildDataPatch,
  refusedKeys,
  targetProviderId,
  unlandedWrites,
  PROTECTED_DATA_KEYS,
} from "../clean-order-fulfillment-data-job"

/**
 * The whole point of this job is that it never relies on omission or `delete`.
 * `updateFulfillment` MERGES `data`, so a key can only be cleared by WRITING
 * null over it — #1293 lost a session to exactly that, with a passing unit test
 * and stale prod data. These tests pin the null behaviour so the trap cannot
 * quietly return.
 */

// Order 83's real shape: Blue Dart values merged on top of a Delhivery response.
const ORDER_83_DATA = {
  id: "delhivery-express",
  mode: "Express",
  name: "Delhivery Express",
  carrier: "bluedart",
  waybill: "21091376574",
  upload_wbn: "UPL2285344091227112226",
  packages: [{ client: "8e2306-JaalYantraTextilesPr-do", waybill: "41712510000092" }],
  tracking_number: "21091376574",
  pickup_location_name: "warehouse-AYV7GRDR",
  cancelled_shipments: [{ awb: "41712510000092" }],
}

describe("buildDataPatch", () => {
  it("writes NULL for cleared keys rather than omitting them", () => {
    const patch = buildDataPatch(ORDER_83_DATA, ["id", "name", "mode"], {})
    expect(patch).toEqual({ id: null, name: null, mode: null })
    // The distinction that matters: the keys are PRESENT with a null value.
    expect(Object.keys(patch)).toContain("name")
    expect("name" in patch).toBe(true)
  })

  it("skips keys that are absent or already null, so the report is honest", () => {
    const patch = buildDataPatch(
      { a: 1, b: null },
      ["a", "b", "never_existed"],
      {}
    )
    expect(patch).toEqual({ a: null })
  })

  it("applies `set` values and skips ones already equal", () => {
    const patch = buildDataPatch(
      { name: "Delhivery Express", carrier: "bluedart" },
      [],
      { name: "Blue Dart Domestic Priority", carrier: "bluedart" }
    )
    expect(patch).toEqual({ name: "Blue Dart Domestic Priority" })
  })

  it("is idempotent — a second run over the patched result yields nothing", () => {
    const keys = ["id", "name", "mode"]
    const first = buildDataPatch(ORDER_83_DATA, keys, {})
    const after = { ...ORDER_83_DATA, ...first }
    expect(buildDataPatch(after, keys, {})).toEqual({})
  })

  it("tolerates a null/undefined data column", () => {
    expect(buildDataPatch(null, ["a"], {})).toEqual({})
    expect(buildDataPatch(undefined, [], { a: 1 })).toEqual({ a: 1 })
  })
})

describe("refusedKeys", () => {
  it("refuses keys carrying live shipment identity", () => {
    expect(refusedKeys(["id", "waybill", "name"], false)).toEqual(["waybill"])
  })

  it("keeps cancelled_shipments protected — it is the audit trail", () => {
    // It still holds the dead Delhivery AWB, which is correct as history.
    expect(PROTECTED_DATA_KEYS).toContain("cancelled_shipments")
    expect(refusedKeys(["cancelled_shipments"], false)).toEqual([
      "cancelled_shipments",
    ])
  })

  it("allows anything once force is set", () => {
    expect(refusedKeys(["waybill", "carrier"], true)).toEqual([])
  })
})

describe("targetProviderId", () => {
  it("derives the provider id from data.carrier", () => {
    expect(
      targetProviderId({ provider_id: "delhivery_delhivery", data: { carrier: "bluedart" } })
    ).toBe("bluedart_bluedart")
  })

  it("returns null when the attribution already matches", () => {
    expect(
      targetProviderId({ provider_id: "bluedart_bluedart", data: { carrier: "bluedart" } })
    ).toBeNull()
  })

  it("returns null when no carrier is recorded — never guesses", () => {
    expect(targetProviderId({ provider_id: "manual_manual", data: {} })).toBeNull()
    expect(targetProviderId({ provider_id: "manual_manual" })).toBeNull()
  })

  it("normalises case and whitespace", () => {
    expect(
      targetProviderId({ provider_id: "x", data: { carrier: " BlueDart " } })
    ).toBe("bluedart_bluedart")
  })
})

/**
 * The read-back check. This job reported `applied: true` on order 83 while
 * `provider_id` never moved — the ORM discards a loose FK scalar without
 * raising, so "no exception" was mistaken for "it landed". These tests pin the
 * only thing that can tell the difference: reading the row back.
 */
describe("unlandedWrites", () => {
  const write = {
    id: "ful_83",
    patch: { name: null, packages: null },
    providerId: "bluedart_bluedart",
  }

  it("reports nothing when every intended write is visible in the row", () => {
    expect(
      unlandedWrites(
        [write],
        [
          {
            id: "ful_83",
            provider_id: "bluedart_bluedart",
            data: { name: null, packages: null, carrier: "bluedart" },
          },
        ]
      )
    ).toEqual([])
  })

  it("catches the order 83 failure: data cleared, provider_id unmoved", () => {
    const errors = unlandedWrites(
      [write],
      [
        {
          id: "ful_83",
          // The write that DID land.
          data: { name: null, packages: null },
          // The write that silently did not.
          provider_id: "delhivery_delhivery",
        },
      ]
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("provider_id did not persist")
    expect(errors[0].message).toContain("delhivery_delhivery")
  })

  it("catches a data key that did not persist — the merge no-op", () => {
    const errors = unlandedWrites(
      [{ id: "ful_83", patch: { name: null }, providerId: null }],
      [{ id: "ful_83", provider_id: "x", data: { name: "Delhivery Express" } }]
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("did not persist: name")
  })

  it("treats a row that cannot be read back as unverified, not as success", () => {
    const errors = unlandedWrites([write], [])
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("could not read it back")
  })

  it("compares structurally, so a jsonb round-trip is not a false alarm", () => {
    const errors = unlandedWrites(
      [
        {
          id: "ful_83",
          patch: { refs: { waybill: "21091376574" } },
          providerId: null,
        },
      ],
      [{ id: "ful_83", data: { refs: { waybill: "21091376574" } } }]
    )
    expect(errors).toEqual([])
  })

  it("ignores provider verification when no alignment was requested", () => {
    expect(
      unlandedWrites(
        [{ id: "ful_83", patch: {}, providerId: null }],
        [{ id: "ful_83", provider_id: "delhivery_delhivery", data: {} }]
      )
    ).toEqual([])
  })
})
