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

import { composeWorkOrderReminder } from "../work-order-whatsapp-text"

describe("composeWorkOrderReminder (#2500)", () => {
  it("one reminder for the bundle, each design with how long it has waited", () => {
    const text = composeWorkOrderReminder({
      greet_name: "Shramdaan",
      order_ref: "152",
      kind: "assignment_pending",
      lines: [
        { design_name: "Bag for Paris", quantity: 10, days: 3 },
        { design_name: "Women cord set", quantity: 2, days: 1 },
      ],
      language: "hinglish",
    })
    expect(text).toContain("order #152 ke 2 design abhi accept hone baaki hain")
    expect(text).toContain("1. Bag for Paris — 10 pcs (3 din)")
    expect(text).toContain("2. Women cord set — 2 pcs (1 din)")
  })

  it("asks an English partner for the action the reminder is about", () => {
    const text = composeWorkOrderReminder({
      greet_name: "Asha",
      order_ref: "153",
      kind: "not_started",
      lines: [{ design_name: "Ruffles", quantity: 2, days: 1 }],
      language: "english",
    })
    expect(text).toContain("1 design on order #153 were accepted but have not started")
    expect(text).toContain("1. Ruffles — 2 pcs (1 day)")
    expect(text).toMatch(/tap Start/)
  })
})
