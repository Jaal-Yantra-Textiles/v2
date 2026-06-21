import {
  buildPartnerProductionRunTemplateData,
  derivePartnerFromEmail,
  resolvePartnerProductionRunTemplateKey,
} from "../partner-production-run-email"

/**
 * #576 slice B — pure helpers for the partner production-run lifecycle email.
 * No container / provider: fast coverage of template-key resolution, the shared
 * from-address derivation, and the Handlebars template-data assembly.
 */
describe("resolvePartnerProductionRunTemplateKey", () => {
  it("maps completed → partner-production-run-completed", () => {
    expect(resolvePartnerProductionRunTemplateKey("completed")).toBe(
      "partner-production-run-completed"
    )
  })

  it("maps cancelled → partner-production-run-cancelled", () => {
    expect(resolvePartnerProductionRunTemplateKey("cancelled")).toBe(
      "partner-production-run-cancelled"
    )
  })

  it("returns null for actions without a partner email", () => {
    expect(resolvePartnerProductionRunTemplateKey("started")).toBeNull()
    expect(resolvePartnerProductionRunTemplateKey("finished")).toBeNull()
    expect(resolvePartnerProductionRunTemplateKey("accepted")).toBeNull()
    expect(resolvePartnerProductionRunTemplateKey(undefined)).toBeNull()
    expect(resolvePartnerProductionRunTemplateKey(null)).toBeNull()
    expect(resolvePartnerProductionRunTemplateKey("")).toBeNull()
  })
})

describe("derivePartnerFromEmail", () => {
  it("builds partner+<handle>@<domain>", () => {
    expect(derivePartnerFromEmail("acme", "partner.jaalyantra.com")).toBe(
      "partner+acme@partner.jaalyantra.com"
    )
  })

  it("lowercases and dash-collapses whitespace, falls back to 'partner'", () => {
    expect(derivePartnerFromEmail("  Acme  Mills ", "x.com")).toBe(
      "partner+acme-mills@x.com"
    )
    expect(derivePartnerFromEmail(null, "x.com")).toBe("partner+partner@x.com")
    expect(derivePartnerFromEmail("", "x.com")).toBe("partner+partner@x.com")
  })
})

describe("buildPartnerProductionRunTemplateData", () => {
  const base = {
    partner: { name: "Acme Mills", handle: "acme" },
    admin: { first_name: "Asha", last_name: "Rao" },
    run: {
      id: "prun_1",
      status: "completed",
      quantity: 100,
      produced_quantity: 98,
      rejected_quantity: 2,
      design_id: "design_1",
      order_id: "order_1",
    },
    action: "completed" as const,
    notes: "All good",
    storeUrl: "https://shop.example.com",
    runUrlBase: "https://dash.example.com/production-runs",
    year: 2026,
  }

  it("assembles the full template data with the run CTA url", () => {
    const data = buildPartnerProductionRunTemplateData(base)
    expect(data).toMatchObject({
      partner_name: "Acme Mills",
      partner_handle: "acme",
      admin_name: "Asha Rao",
      admin_first_name: "Asha",
      run_id: "prun_1",
      run_action: "completed",
      run_status: "completed",
      run_quantity: "100",
      produced_quantity: "98",
      rejected_quantity: "2",
      design_id: "design_1",
      order_id: "order_1",
      notes: "All good",
      run_url: "https://dash.example.com/production-runs/prun_1",
      current_year: "2026",
      store_url: "https://shop.example.com",
    })
  })

  it("carries the cancelled action + reason through", () => {
    const data = buildPartnerProductionRunTemplateData({
      ...base,
      action: "cancelled",
      run: { ...base.run, status: "cancelled" },
      notes: "Out of stock",
    })
    expect(data.run_action).toBe("cancelled")
    expect(data.run_status).toBe("cancelled")
    expect(data.notes).toBe("Out of stock")
  })

  it("blanks the run url when base or id is missing", () => {
    expect(
      buildPartnerProductionRunTemplateData({ ...base, runUrlBase: "" }).run_url
    ).toBe("")
    expect(
      buildPartnerProductionRunTemplateData({
        ...base,
        run: { ...base.run, id: "" },
      }).run_url
    ).toBe("")
  })

  it("renders missing/null fields as blank, never 'undefined'", () => {
    const data = buildPartnerProductionRunTemplateData({
      partner: {},
      admin: {},
      run: {},
      action: "completed",
    })
    expect(data.partner_name).toBe("Partner")
    expect(data.admin_name).toBe("")
    expect(data.run_id).toBe("")
    expect(data.run_quantity).toBe("")
    expect(data.produced_quantity).toBe("")
    expect(data.rejected_quantity).toBe("")
    expect(data.design_id).toBe("")
    expect(data.notes).toBe("")
    expect(Object.values(data)).not.toContain("undefined")
  })

  it("treats a zero produced/rejected quantity as a real value, not blank", () => {
    const data = buildPartnerProductionRunTemplateData({
      ...base,
      run: { ...base.run, produced_quantity: 0, rejected_quantity: 0 },
    })
    expect(data.produced_quantity).toBe("0")
    expect(data.rejected_quantity).toBe("0")
  })
})
