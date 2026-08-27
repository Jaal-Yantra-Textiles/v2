import * as Handlebars from "handlebars"

import { partnerEmailTemplates } from "../seed-partner-email-templates"
import { buildPartnerProductionRunTemplateData } from "../../workflows/email/workflows/partner-production-run-email-lib"

/**
 * #1574 — render the SEED bodies, not a paraphrase of them.
 *
 * These templates live only in a database once seeded, so the body a partner
 * actually receives is never exercised by any other test. A mis-nested
 * `{{#if}}` renders as silence: Handlebars drops the whole branch and the mail
 * still sends, still looks plausible, and simply omits the thing it existed to
 * say. Compiling the real string and asserting the words is the only check that
 * can tell.
 */
const templateFor = (key: string) => {
  const def = partnerEmailTemplates.find((t) => t.template_key === key)
  if (!def) throw new Error(`No seed template for "${key}"`)
  return {
    html: Handlebars.compile(def.html_content),
    subject: Handlebars.compile(def.subject),
  }
}

const partner = { name: "Acme Mills", handle: "acme" }
const admin = { first_name: "Asha", last_name: "Rao" }
const run = { id: "prod_run_1", status: "in_progress", quantity: 40 }

describe("partner-production-run-expiring", () => {
  const t = templateFor("partner-production-run-expiring")
  const data = buildPartnerProductionRunTemplateData({
    partner,
    admin,
    run,
    action: "expiring",
    inactivity: {
      inactive_days: 24,
      window_days: 28,
      days_until_cancel: 4,
      cancel_on: "2026-08-31",
      last_activity_at: "2026-08-03T05:25:03.184Z",
    },
    runUrlBase: "https://partner.example.com/production-runs",
    year: 2026,
  })

  it("says how long it has been idle and the date it will be cancelled", () => {
    const html = t.html(data)
    expect(html).toContain("24 days")
    expect(html).toContain("2026-08-31")
    expect(html).toContain("4 days")
    expect(html).toContain("After 28 days without activity")
  })

  it("tells the partner what resets the clock", () => {
    // A deadline with no stated remedy is a threat, not a notice.
    const html = t.html(data)
    expect(html).toMatch(/accept it, start it, or finish it/i)
    expect(html).toMatch(/resets the clock/i)
  })

  it("puts the deadline in the subject line", () => {
    expect(t.subject(data)).toBe(
      "⏳ Run prod_run_1 will be cancelled in 4 days"
    )
  })

  it("renders without a run_url or a last activity stamp", () => {
    const sparse = buildPartnerProductionRunTemplateData({
      partner,
      admin,
      run: { id: "prod_run_2" },
      action: "expiring",
      inactivity: { inactive_days: 22, window_days: 28, days_until_cancel: 6 },
      year: 2026,
    })
    const html = t.html(sparse)
    expect(html).toContain("22 days")
    expect(html).toContain("shortly")
    expect(html).not.toContain("Open run")
    expect(html).not.toContain("Last activity")
    expect(html).not.toContain("undefined")
  })
})

describe("partner-production-run-cancelled", () => {
  const t = templateFor("partner-production-run-cancelled")

  it("explains the inactivity when the sweep cancelled it", () => {
    const html = t.html(
      buildPartnerProductionRunTemplateData({
        partner,
        admin,
        run,
        action: "cancelled",
        notes: "Cancelled automatically after 81 days without activity.",
        inactivity: {
          inactive_days: 81,
          window_days: 28,
          last_activity_at: "2026-06-06T06:14:13.421Z",
        },
        year: 2026,
      })
    )
    // The run's OWN age, which is the number the partner can reconcile with
    // what they are looking at.
    expect(html).toContain("81 days")
    expect(html).toContain("28-day inactivity window")
    expect(html).toContain("2026-06-06")
    expect(html).toMatch(/re-create and re-assign/i)
    // The generic branch must NOT also render — the two are exclusive.
    expect(html).not.toContain("No further action is needed")
  })

  it("renders an ADMIN cancel exactly as it did before #1574", () => {
    // Same template, no inactivity context: the whole block is gated off and
    // the free-text reason is what the partner sees.
    const html = t.html(
      buildPartnerProductionRunTemplateData({
        partner,
        admin,
        run,
        action: "cancelled",
        notes: "Buyer withdrew the order.",
        year: 2026,
      })
    )
    expect(html).toContain("Buyer withdrew the order.")
    expect(html).toContain("No further action is needed")
    expect(html).not.toContain("inactivity window")
    expect(html).not.toContain("Idle for")
    expect(html).not.toContain("undefined")
  })
})

describe("the seed rows themselves", () => {
  it("declares every variable the expiring body renders", () => {
    const def = partnerEmailTemplates.find(
      (t) => t.template_key === "partner-production-run-expiring"
    )!
    const used = new Set(
      [...def.html_content.matchAll(/\{\{#?if\s+(\w+)\}\}|\{\{(\w+)\}\}/g)]
        .map((m) => m[1] || m[2])
        // `{{else}}` is a block keyword, not a variable.
        .filter((v) => v && v !== "else")
    )
    for (const v of used) {
      expect(Object.keys(def.variables)).toContain(v)
    }
  })

  it("has no duplicate template keys", () => {
    const keys = partnerEmailTemplates.map((t) => t.template_key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
