import {
  buildPartnerTaskTemplateData,
  derivePartnerFromEmail,
} from "../partner-task-email"

/**
 * #332 — pure helpers for the partner "task assigned" email.
 * No container / provider — fast unit coverage of the from-address derivation
 * and Handlebars template-data assembly.
 */
describe("derivePartnerFromEmail", () => {
  it("builds partner+<handle>@<domain>", () => {
    expect(derivePartnerFromEmail("acme", "partner.jaalyantra.com")).toBe(
      "partner+acme@partner.jaalyantra.com"
    )
  })

  it("lowercases and dash-collapses whitespace in the handle", () => {
    expect(derivePartnerFromEmail("  Acme  Mills ", "x.com")).toBe(
      "partner+acme-mills@x.com"
    )
  })

  it("falls back to 'partner' when handle is null/empty", () => {
    expect(derivePartnerFromEmail(null, "x.com")).toBe("partner+partner@x.com")
    expect(derivePartnerFromEmail("", "x.com")).toBe("partner+partner@x.com")
  })
})

describe("buildPartnerTaskTemplateData", () => {
  const base = {
    partner: { name: "Acme Mills", handle: "acme" },
    admin: { first_name: "Asha", last_name: "Rao" },
    task: {
      id: "task_1",
      title: "Stitch sample",
      description: "Run the first sample",
      priority: "high",
      status: "assigned",
    },
    year: 2026,
  }

  it("maps every template variable the partner-task-assigned template uses", () => {
    const d = buildPartnerTaskTemplateData(base)
    expect(d.partner_name).toBe("Acme Mills")
    expect(d.partner_handle).toBe("acme")
    expect(d.admin_name).toBe("Asha Rao")
    expect(d.admin_first_name).toBe("Asha")
    expect(d.task_id).toBe("task_1")
    expect(d.task_title).toBe("Stitch sample")
    expect(d.task_description).toBe("Run the first sample")
    expect(d.task_priority).toBe("high")
    expect(d.task_status).toBe("assigned")
    expect(d.current_year).toBe("2026")
  })

  it("builds the task_url from base + id, trimming a trailing slash", () => {
    const d = buildPartnerTaskTemplateData({
      ...base,
      taskUrlBase: "https://dash.example.com/tasks/",
    })
    expect(d.task_url).toBe("https://dash.example.com/tasks/task_1")
  })

  it("leaves task_url blank when no base is provided", () => {
    expect(buildPartnerTaskTemplateData(base).task_url).toBe("")
  })

  it("leaves task_url blank when the task has no id", () => {
    const d = buildPartnerTaskTemplateData({
      ...base,
      task: { ...base.task, id: "" },
      taskUrlBase: "https://dash.example.com/tasks",
    })
    expect(d.task_url).toBe("")
  })

  it("coerces null/undefined fields to blank strings (never 'undefined')", () => {
    const d = buildPartnerTaskTemplateData({
      partner: { name: null, handle: null },
      admin: { first_name: null, last_name: null },
      task: {
        id: null,
        title: null,
        description: null,
        priority: null,
        status: null,
      },
      year: 2026,
    })
    expect(d.partner_name).toBe("Partner")
    expect(d.partner_handle).toBe("")
    expect(d.admin_name).toBe("")
    expect(d.task_title).toBe("")
    expect(d.task_description).toBe("")
    expect(Object.values(d).every((v) => typeof v === "string")).toBe(true)
    expect(Object.values(d).some((v) => v.includes("undefined"))).toBe(false)
  })

  it("defaults current_year to the real year when omitted", () => {
    const { year, ...noYear } = base
    const d = buildPartnerTaskTemplateData(noYear)
    expect(d.current_year).toBe(String(new Date().getFullYear()))
  })
})
