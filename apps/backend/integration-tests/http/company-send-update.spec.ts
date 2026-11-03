import { Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { investorEmailTemplates } from "../../src/scripts/seed-investor-email-templates"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120 * 1000)

/**
 * POST /admin/companies/:id/send-update — a company's letter to its investors
 * through the platform email service. Previews by default; each investor gets
 * their own email; hand-added investors with a placeholder address are skipped.
 */
setupSharedTestSuite(() => {
  describe("company update letter to investors", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: Record<string, any>
    let companyId: string
    const unique = Date.now()
    const emailA = `founder-a-${unique}@medusa-test.com`
    const emailB = `investor-b-${unique}@medusa-test.com`

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      const company = await api.post(
        "/admin/companies",
        {
          name: `Update Co ${unique}`,
          legal_name: `Update Co Private Limited ${unique}`,
          email: `info-${unique}@medusa-test.com`,
          phone: "+910000000000",
          address: "1 Test Road",
          city: "Delhi",
          state: "DL",
          country: "IN",
          postal_code: "110001",
        },
        adminHeaders
      )
      companyId = company.data.company.id

      const capTable = await api.post(
        `/admin/companies/${companyId}/cap-tables`,
        { name: "Common", currency_code: "INR", total_shares_authorized: 100000 },
        adminHeaders
      )
      const capTableId = capTable.data.cap_table.id
      // Manual provision creates each investor inline and links it to the company.
      for (const [name, email, shares] of [
        ["Founder A", emailA, 9000],
        ["Investor B", emailB, 1000],
        ["Hand Added", undefined, 500],
      ] as const) {
        await api.post(
          `/admin/cap-tables/${capTableId}/stakes`,
          { investor: { name, ...(email ? { email } : {}) }, number_of_shares: shares },
          adminHeaders
        )
      }
    })

    const letter = {
      subject: "Updated shareholding",
      message: "A quick update.\n\n- Founder A: 90%\n- Investor B: 10%\n\n<b>not bold</b>",
    }

    it("previews without sending, names who gets it and who is left out", async () => {
      const notifications: any = getContainer().resolve(Modules.NOTIFICATION)
      const before = (await notifications.listNotifications({ template: "investor-update" })).length

      const res = await api.post(`/admin/companies/${companyId}/send-update`, letter, adminHeaders)
      expect(res.status).toBe(200)
      expect(res.data.preview).toBe(true)
      expect(res.data.sent).toBe(0)
      expect(res.data.recipients.map((r: any) => r.email).sort()).toEqual([emailA, emailB].sort())
      expect(res.data.skipped).toEqual([
        expect.objectContaining({ name: "Hand Added", reason: expect.stringContaining("placeholder") }),
      ])
      expect(res.data.body_html).toContain("<ul><li>Founder A: 90%</li><li>Investor B: 10%</li></ul>")
      expect(res.data.body_html).toContain("&lt;b&gt;not bold&lt;/b&gt;")
      expect(res.data.template_ready).toBe(false)

      const after = (await notifications.listNotifications({ template: "investor-update" })).length
      expect(after).toBe(before)
    })

    it("refuses to send while the template is missing", async () => {
      const res = await api
        .post(`/admin/companies/${companyId}/send-update`, { ...letter, confirm: true }, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.data)).toContain("investor-update")
    })

    it("sends one email to each investor, each addressed only to them", async () => {
      const template = investorEmailTemplates.find((t) => t.template_key === "investor-update")!
      await api.post("/admin/email-templates", template, adminHeaders)

      const res = await api.post(
        `/admin/companies/${companyId}/send-update`,
        { ...letter, sender_name: "Founder A", confirm: true },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.preview).toBe(false)
      expect(res.data.sent).toBe(2)
      expect(res.data.failed).toBe(0)

      const notifications: any = getContainer().resolve(Modules.NOTIFICATION)
      const mail = await notifications.listNotifications({ template: "investor-update" })
      const mine = mail.filter((n: any) => [emailA, emailB].includes(n.to))
      expect(mine.map((n: any) => n.to).sort()).toEqual([emailA, emailB].sort())
      for (const n of mine) {
        expect(n.data.subject).toBe("Updated shareholding")
        expect(n.data.sender_name).toBe("Founder A")
        expect(n.data.investor_name).toBe(n.to === emailA ? "Founder A" : "Investor B")
        // The rendered letter carries the escaped body — never the raw markup.
        expect(n.data._template_html_content).toContain("Founder A: 90%")
        expect(n.data._template_html_content).not.toContain("<b>not bold</b>")
      }
    })
  })
})
