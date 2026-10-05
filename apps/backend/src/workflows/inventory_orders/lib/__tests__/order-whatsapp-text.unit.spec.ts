import {
  composeOrderMessage,
  flattenForTemplate,
  formatMoney,
} from "../order-whatsapp-text"

const kalaCotton = {
  greet_name: "Haresh",
  order_ref: "60GP9",
  lines: [
    { title: "Red Dyed Kala Cotton", quantity: 10, unit: "Meter", price: 300 },
    { title: "Organic Kala Cotton — Navy with White Weft Stripes", quantity: 20, unit: "Meter", price: 400 },
  ],
  total_price: 11000,
  currency_code: "inr",
  is_sample: false,
  notes: null,
  language: "hinglish",
}

describe("composeOrderMessage", () => {
  it("lists every item with quantity and rate, then the totals, in Hinglish", () => {
    expect(composeOrderMessage(kalaCotton)).toBe(
      [
        "Namaste Haresh ji, aapke liye JYT ka naya order hai (#60GP9):",
        "",
        "1. Red Dyed Kala Cotton — 10 m @ ₹300/m",
        "2. Organic Kala Cotton — Navy with White Weft Stripes — 20 m @ ₹400/m",
        "",
        "Kul: 30 m, ₹11,000",
        "",
        "Kripya item-wise dekh kar quantity confirm kar dijiye. Kaam shuru karte hi JYT app mein order par Start daba dijiye.",
      ].join("\n")
    )
  })

  it("says SAMPLE, drops prices, and states there is no charge", () => {
    const text = composeOrderMessage({
      ...kalaCotton,
      greet_name: "Afzal",
      is_sample: true,
      total_price: 0,
      lines: [
        { title: "Matka Ari Silk", quantity: 6, unit: "Meter", price: 0 },
        { title: "Matka Arsi Silk", quantity: 6, unit: "Meter", price: 0 },
      ],
    })
    expect(text).toContain("naya SAMPLE order")
    expect(text).toContain("1. Matka Ari Silk — 6 m")
    expect(text).not.toContain("₹")
    expect(text).toContain("Kul: 12 m")
    expect(text).toContain("Yeh sample hai — iska koi charge nahi hai.")
  })

  it("writes English for an english-speaking partner and carries the admin's note", () => {
    const text = composeOrderMessage({ ...kalaCotton, language: "english", notes: "Send photos of each colour." })
    expect(text.startsWith("Hello Haresh, here is a new order from JYT (#60GP9):")).toBe(true)
    expect(text).toContain("Total: 30 m, ₹11,000")
    expect(text).toContain("Note: Send photos of each colour.")
    expect(text).toContain("confirm the quantities")
  })

  it("omits a quantity total when units differ, rather than adding metres to pieces", () => {
    const text = composeOrderMessage({
      ...kalaCotton,
      lines: [
        { title: "Fabric", quantity: 10, unit: "Meter", price: 300 },
        { title: "Buttons", quantity: 50, unit: "Piece", price: 2 },
      ],
      total_price: 3100,
    })
    expect(text).toContain("Kul: ₹3,100")
    expect(text).not.toMatch(/Kul: \d+ /)
  })
})

describe("flattenForTemplate", () => {
  it("joins lines with ' · ' — a template body parameter may not contain newlines", () => {
    const { text, truncated } = flattenForTemplate(composeOrderMessage(kalaCotton))
    expect(text).not.toMatch(/\n/)
    expect(text).toContain("1. Red Dyed Kala Cotton — 10 m @ ₹300/m · 2. Organic Kala Cotton")
    expect(truncated).toBe(false)
  })

  it("holds a long order to Meta's 700-char limit and marks the cut", () => {
    const many = {
      ...kalaCotton,
      lines: Array.from({ length: 40 }, (_, i) => ({
        title: `Organic Kala Cotton colour ${i + 1}`,
        quantity: 10,
        unit: "Meter",
        price: 300,
      })),
    }
    const { text, truncated } = flattenForTemplate(composeOrderMessage(many))
    expect(text.length).toBeLessThanOrEqual(700)
    expect(truncated).toBe(true)
    expect(text.endsWith("…")).toBe(true)
  })
})

describe("formatMoney", () => {
  it("uses Indian digit grouping for rupees", () => {
    expect(formatMoney(129000, "inr")).toBe("₹1,29,000")
    expect(formatMoney(283.72, "INR")).toBe("₹283.72")
  })
})
