import { formatPriceLabel, productCardFromProduct, productCardHref } from "../product-card-data"

describe("formatPriceLabel", () => {
  const variants = [
    { prices: [{ amount: 3200, currency_code: "inr" }, { amount: 45, currency_code: "usd" }] },
    { prices: [{ amount: 2500, currency_code: "inr" }, { amount: 40, currency_code: "usd" }] },
  ]

  it("shows the lowest price, with From when variants differ", () => {
    expect(formatPriceLabel(variants, "inr")).toBe("From ₹2,500")
    expect(formatPriceLabel(variants, "USD")).toBe("From $40")
  })

  it("drops From when every variant costs the same", () => {
    expect(formatPriceLabel([variants[1], variants[1]], "inr")).toBe("₹2,500")
  })

  it("is null when nothing is priced in that currency", () => {
    expect(formatPriceLabel(variants, "eur")).toBeNull()
    expect(formatPriceLabel([], "inr")).toBeNull()
    expect(formatPriceLabel(undefined, "inr")).toBeNull()
  })

  it("keeps a zero price (0 is a price, not missing)", () => {
    expect(formatPriceLabel([{ prices: [{ amount: 0, currency_code: "inr" }] }], "inr")).toBe("₹0")
  })
})

describe("productCardHref", () => {
  it("links the product on the house shop with newsletter UTM tags", () => {
    const url = new URL(productCardHref("stunning-yellow", "monsoon-weaves"))
    expect(url.origin + url.pathname).toBe("https://cicilabel.com/products/stunning-yellow")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "monsoon-weaves",
      utm_content: "product_card",
    })
  })

  it("falls back to the send path's campaign name, and to the shop front without a handle", () => {
    const url = new URL(productCardHref(null, ""))
    expect(url.pathname).toBe("/")
    expect(url.searchParams.get("utm_campaign")).toBe("blog_broadcast")
  })
})

describe("productCardFromProduct", () => {
  it("uses the thumbnail, else the first image", () => {
    const card = productCardFromProduct(
      { id: "prod_1", title: "Two Piece", handle: "two-piece", thumbnail: null, images: [{ url: "https://img/1.jpg" }] },
      "inr"
    )
    expect(card).toEqual({
      productId: "prod_1",
      handle: "two-piece",
      title: "Two Piece",
      imageUrl: "https://img/1.jpg",
      priceLabel: null,
      buttonLabel: "Shop now",
    })
  })
})
