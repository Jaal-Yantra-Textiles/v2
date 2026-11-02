import { composeWorkOrderMessage } from "../work-order-whatsapp-text"

const lines = [
  { design_name: "Bag for Paris", quantity: 10 },
  { design_name: "Women cord set", quantity: 2 },
  { design_name: "Patch-work Shirt", quantity: 1 },
]

describe("composeWorkOrderMessage (#2500)", () => {
  it("lists every design of the bundle in one message, with its quantity", () => {
    const text = composeWorkOrderMessage({
      greet_name: "Shramdaan",
      order_ref: "152",
      lines,
      language: "hinglish",
    })
    expect(text).toContain("#152")
    expect(text).toContain("3 design, 13 pcs")
    expect(text).toContain("1. Bag for Paris — 10 pcs")
    expect(text).toContain("2. Women cord set — 2 pcs")
    expect(text).toContain("3. Patch-work Shirt — 1 pcs")
    expect(text).toMatch(/accept/)
  })

  it("speaks English to an English partner", () => {
    const text = composeWorkOrderMessage({
      greet_name: "Asha",
      order_ref: "153",
      lines: [{ design_name: "Tye and Dye Ruffles", quantity: 2 }],
      language: "english",
    })
    expect(text).toMatch(/^Hello Asha, here is a new design order from JYT \(#153\): 1 design, 2 pcs\./)
    expect(text).toContain("1. Tye and Dye Ruffles — 2 pcs")
  })
})
