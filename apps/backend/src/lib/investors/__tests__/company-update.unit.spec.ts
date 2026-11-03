import { planUpdateRecipients, updateMessageToHtml } from "../company-update"

describe("planUpdateRecipients", () => {
  const investors = [
    { id: "inv_a", name: "Founder A", email: "a@example.com" },
    { id: "inv_b", name: "Investor B", email: " B@Example.com " },
    { id: "inv_c", name: "Hand-added", email: "manual-1700000000-abc123@captable.local" },
    { id: "inv_d", name: "No mail", email: null },
    { id: "inv_e", name: "Same mailbox", email: "a@example.com" },
  ]

  it("sends one email per real address and says why the rest are left out", () => {
    const { recipients, skipped } = planUpdateRecipients(investors)
    expect(recipients).toEqual([
      { investor_id: "inv_a", name: "Founder A", email: "a@example.com" },
      { investor_id: "inv_b", name: "Investor B", email: "b@example.com" },
    ])
    expect(skipped.map((s) => [s.investor_id, s.reason.split(" (")[0]])).toEqual([
      ["inv_c", "placeholder address"],
      ["inv_d", "no email address"],
      ["inv_e", "same address as another investor"],
    ])
  })

  it("narrows to named investors and never mails an id outside the company", () => {
    const { recipients, skipped } = planUpdateRecipients(investors, ["inv_b", "inv_outsider"])
    expect(recipients.map((r) => r.investor_id)).toEqual(["inv_b"])
    expect(skipped).toEqual([
      { investor_id: "inv_outsider", name: "inv_outsider", reason: "not an investor of this company" },
    ])
  })

  it("counts an investor linked twice (two pipeline rows) once", () => {
    const { recipients, skipped } = planUpdateRecipients([investors[0], investors[0]])
    expect(recipients).toHaveLength(1)
    expect(skipped).toHaveLength(0)
  })
})

describe("updateMessageToHtml", () => {
  it("makes paragraphs, bullet lists and clickable links", () => {
    const html = updateMessageToHtml(
      "A quick update.\nSecond line.\n\n- Founder A: 90%\n- Founder B: 10%\n\nSee https://invest.example.com/cap-table."
    )
    expect(html).toBe(
      [
        "<p>A quick update.<br>Second line.</p>",
        "<ul><li>Founder A: 90%</li><li>Founder B: 10%</li></ul>",
        '<p>See <a href="https://invest.example.com/cap-table">https://invest.example.com/cap-table</a>.</p>',
      ].join("\n")
    )
  })

  it("escapes markup so the text cannot inject HTML into the email", () => {
    const html = updateMessageToHtml(`<script>alert(1)</script> & "quotes"`)
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>")
    expect(html).not.toContain("<script>")
  })

  it("keeps an encoded link (spaces as %20) whole", () => {
    const html = updateMessageToHtml("Accounts: https://cdn.example.com/a%20b%20c.pdf")
    expect(html).toContain('<a href="https://cdn.example.com/a%20b%20c.pdf">')
  })
})
