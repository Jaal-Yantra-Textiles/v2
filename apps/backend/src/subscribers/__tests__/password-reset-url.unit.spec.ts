import { resetUrlPrefixFor } from "../password-reset"

describe("password reset link — each actor lands on its own app", () => {
  it("sends an investor to the investor app, not the admin dashboard", () => {
    expect(resetUrlPrefixFor("investor")).toBe("https://invest.jaalyantra.com")
  })

  it("keeps customers, partners and admin users where they were", () => {
    expect(resetUrlPrefixFor("customer")).toBe("https://cicilabel.com")
    expect(resetUrlPrefixFor("partner")).toBe("https://partner.jaalyantra.com")
    expect(resetUrlPrefixFor("user")).toBe("https://v3.jaalyantra.com/app")
  })
})
