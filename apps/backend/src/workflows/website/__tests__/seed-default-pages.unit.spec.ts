import { buildDefaultPages, storeFromPartner } from "../seed-default-pages"

const PLATFORM = [/jytcommerce/i, /JYT Commerce/i]

const pageText = (page: unknown) => JSON.stringify(page)

const textNodes = (node: any): string[] =>
  !node || typeof node !== "object"
    ? []
    : [
        ...(typeof node.text === "string" ? [node.text] : []),
        ...(Array.isArray(node.content) ? node.content.flatMap(textNodes) : []),
      ]

describe("buildDefaultPages", () => {
  it("puts the store's own name, email and phone on the contact page and never the platform's", () => {
    const pages = buildDefaultPages({
      name: "Acme Looms",
      email: "hello@acmelooms.in",
      phone: "+91 98765 43210",
    })
    const contact = pages.find((p) => p.slug === "contact-us")!
    const contactText = pageText(contact)

    expect(contactText).toContain("Acme Looms")
    expect(contactText).toContain("hello@acmelooms.in")
    expect(contactText).toContain("+91 98765 43210")
    for (const page of pages) {
      for (const re of PLATFORM) expect(pageText(page)).not.toMatch(re)
    }
    // the store name reaches the other pages too
    expect(pageText(pages.find((p) => p.slug === "terms-and-conditions"))).toContain(
      "Acme Looms"
    )
  })

  it("uses neutral wording with no platform details and no empty contact lines when nothing is known", () => {
    for (const pages of [buildDefaultPages(), buildDefaultPages({ name: " ", email: null, phone: "" })]) {
      for (const page of pages) {
        const t = pageText(page)
        for (const re of PLATFORM) expect(t).not.toMatch(re)
        expect(t).not.toMatch(/"Email"/)
        expect(t).not.toMatch(/"Phone"/)
        // no "Email: " / ": " text node with nothing after it
        for (const s of textNodes(page.body)) {
          expect(s).not.toMatch(/^\s*:\s*$/)
          expect(s).not.toMatch(/\b(e-?mail|phone)\s*:\s*$/i)
        }
        expect(t).not.toContain("undefined")
        expect(t).not.toContain("null")
      }
      const contact = pages.find((p) => p.slug === "contact-us")!
      expect(pageText(contact)).not.toContain("Other Ways to Reach Us")
    }
  })

  it("lists only the contact details that are known", () => {
    const t = pageText(
      buildDefaultPages({ email: "hi@store.in" }).find((p) => p.slug === "contact-us")
    )
    expect(t).toContain("hi@store.in")
    expect(t).not.toMatch(/"Phone"/)
  })

  it("seeds exactly the five default pages", () => {
    expect(buildDefaultPages().map((p) => p.slug)).toEqual([
      "terms-and-conditions",
      "privacy-policy",
      "contact-us",
      "shipping-and-returns",
      "faq",
    ])
  })

  it("never seeds an About page (the storefront builds /about from the home-page story)", () => {
    const pages = buildDefaultPages({ name: "Acme Looms" })
    for (const page of pages) {
      expect(page.page_type).not.toBe("About")
      expect(page.slug).not.toMatch(/about/)
    }
  })
})

describe("storeFromPartner", () => {
  it("prefers the owner admin's email and the contact_phone in metadata", () => {
    expect(
      storeFromPartner({
        name: "Acme Looms",
        metadata: { contact_phone: "+91 11111 11111" },
        admins: [
          { role: "admin", email: "staff@acme.in", phone: "222", is_active: true },
          { role: "owner", email: "owner@acme.in", phone: "333", is_active: true },
        ],
      })
    ).toEqual({ name: "Acme Looms", email: "owner@acme.in", phone: "+91 11111 11111" })
  })

  it("falls back to the first active admin and its phone, and to business_name", () => {
    expect(
      storeFromPartner({
        name: "",
        metadata: { business_name: "Acme Looms Pvt Ltd" },
        admins: [
          { role: "owner", email: "gone@acme.in", is_active: false },
          { role: "manager", email: "m@acme.in", phone: "444" },
        ],
      })
    ).toEqual({ name: "Acme Looms Pvt Ltd", email: "m@acme.in", phone: "444" })
  })

  it("returns nulls rather than throwing when the partner is sparse", () => {
    expect(storeFromPartner(null)).toEqual({})
    expect(storeFromPartner({ name: "X" })).toEqual({ name: "X", email: null, phone: null })
  })
})
