import { ADMIN_MCP_TOOLS } from "../registry"

/**
 * The partner record can finally say WHO a partner legally is, and WHERE to pay
 * them.
 *
 * The defect these pin down is a quiet one, and worth naming precisely. It was
 * never that `tax_id` did not exist — it has been a typed column on the partner
 * model since #348, the PUT route passes its body straight through, and the
 * workflow spreads it into the service. The column was writable the whole time.
 *
 * What was missing was that nothing ADVERTISED it. No validator named it, no
 * type declared it, and the MCP tool's `bodyParams` allowlist silently dropped
 * it — so an agent sending `tax_id` got a cheerful 200 and no change. A field
 * that looks unsupported and behaves supported is worse than one that is
 * simply absent, because the failure is a success.
 *
 * 🔴 And a null there is not "unknown". `tax-id-lib.ts` falls back to the
 * PLATFORM's tax ID, so every invoice and label raised for a partner without
 * one silently carries OUR registration instead of theirs.
 *
 * These are contract tests: they assert the tool advertises and ROUTES the
 * field, which is the half that was missing. The field-coverage suite checks
 * the other half — that nothing advertised here would be rejected by the route.
 */
const tool = (name: string) => {
  const found = (ADMIN_MCP_TOOLS as any[]).find((t) => t.name === name)
  if (!found) {
    throw new Error(
      `tool ${name} is not registered — this suite is about its contract, so its absence is the failure`
    )
  }
  return found
}

describe("update_partner carries the partner's own tax identity", () => {
  const t = () => tool("update_partner")

  it("🔴 routes tax_id as a BODY param, not just as schema decoration", () => {
    // The original bug in one line: the field was in neither list, so the
    // dispatcher dropped it and the write reported success.
    expect(t().bodyParams).toEqual(expect.arrayContaining(["tax_id", "tax_id_type"]))
  })

  it("advertises both to the model", () => {
    const props = t().inputSchema.properties
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["tax_id", "tax_id_type"])
    )
  })

  it("says out loud that a null falls back to OUR tax id", () => {
    // A model that cannot see the consequence will treat this as optional
    // tidying rather than a compliance fix.
    expect(t().inputSchema.properties.tax_id.description).toMatch(/PLATFORM/)
  })

  it("tells the model to send the type alongside the number", () => {
    expect(t().inputSchema.properties.tax_id_type.description).toMatch(/GSTIN/)
  })

  it("still warns against 'correcting' workspace_type", () => {
    // #2061/#2067 — the enum conflates two independent questions, so a model
    // tidying it up while editing a name would be making it wrong, not right.
    expect(t().inputSchema.properties.workspace_type.description).toMatch(/#2061/)
  })
})

describe("partner payout details", () => {
  it("exposes both a read and a write — a write with no read invites a blind overwrite", () => {
    expect(tool("list_partner_payment_methods").method).toBe("GET")
    expect(tool("add_partner_payment_method").method).toBe("POST")
  })

  it("🔴 treats adding a payout destination as sensitive", () => {
    // Real money is sent here. It must not be doable without confirmation.
    expect(tool("add_partner_payment_method").sensitive).toBe(true)
    expect(tool("add_partner_payment_method").write).toBe(true)
  })

  it("requires the three fields the route requires, and no more", () => {
    expect(tool("add_partner_payment_method").inputSchema.required).toEqual([
      "id",
      "type",
      "account_name",
    ])
  })

  it("routes every bank field the validator accepts", () => {
    expect(tool("add_partner_payment_method").bodyParams).toEqual(
      expect.arrayContaining([
        "type",
        "account_name",
        "account_number",
        "bank_name",
        "ifsc_code",
        "is_default",
      ])
    )
  })

  it("🔴 warns that is_default is EXCLUSIVE", () => {
    // A partner with two accounts and no default used to be paid to whichever
    // row the link query returned first. Setting a default unsets the others,
    // and a model that does not know that can silently redirect a payout.
    expect(
      tool("add_partner_payment_method").inputSchema.properties.is_default.description
    ).toMatch(/EXCLUSIVE/i)
  })

  it("warns about the zero in an IFSC code", () => {
    // BDBL0002217 — the 5th character is a digit zero in every IFSC, and a
    // transcribed letter O is indistinguishable from a correct code until a
    // payout fails.
    expect(
      tool("add_partner_payment_method").inputSchema.properties.ifsc_code.description
    ).toMatch(/ZERO/)
  })

  it("points the reader at the list before the write", () => {
    expect(tool("list_partner_payment_methods").nextSteps).toContain(
      "add_partner_payment_method"
    )
  })
})

describe("update_stock_location", () => {
  it("does NOT advertise address_id, which would repoint the location at another address row", () => {
    // Core accepts it. Offering it beside `name` invites someone renaming a
    // warehouse to silently move it.
    expect(Object.keys(tool("update_stock_location").inputSchema.properties)).not.toContain(
      "address_id"
    )
  })

  it("🔴 says the carrier's pickup handle is NOT renamed with it", () => {
    // `metadata.shiprocket_pickup_location` is the carrier's own name for the
    // pickup point. Changing it would break shipments already in flight.
    expect(tool("update_stock_location").description).toMatch(/shiprocket_pickup_location/)
  })

  it("warns that an address is REPLACED, not merged", () => {
    expect(tool("update_stock_location").inputSchema.properties.address.description).toMatch(
      /REPLACES/
    )
  })
})
