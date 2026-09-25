import {
  buildRunAckSystemPrompt,
  buildRunAckUserPrompt,
  isRunAckUsable,
  composeRunAck,
  isNaturalRunAcksEnabled,
  RUN_ACK_MAX_CHARS,
  type RunAckFacts,
} from "../whatsapp-run-ack-prompt"

const FACTS: RunAckFacts = {
  runId: "prod_run_01M22YXTZKQXBSD23MZAQBVRTE",
  designName: "Pashmina Inspired Tunic",
  quantity: 2,
}

describe("isNaturalRunAcksEnabled", () => {
  const prev = process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED
  afterEach(() => {
    process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED = prev
  })

  it("ships dark", () => {
    delete process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED
    expect(isNaturalRunAcksEnabled()).toBe(false)
  })

  it("turns on for the usual truthy spellings", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED = v
      expect(isNaturalRunAcksEnabled()).toBe(true)
    }
  })
})

describe("buildRunAckUserPrompt", () => {
  it("🔴 never puts the run id in the prompt", () => {
    /*
     * The strongest guarantee available: a model cannot mangle an identifier
     * it was never shown. The caller appends it afterwards.
     */
    const prompt = buildRunAckUserPrompt({ intent: "accepted", facts: FACTS })
    expect(prompt).not.toContain(FACTS.runId)
    expect(prompt).toContain("Pashmina Inspired Tunic")
  })

  it("carries the produced quantity only when there is one", () => {
    expect(
      buildRunAckUserPrompt({ intent: "completed", facts: FACTS })
    ).not.toContain("Quantity produced")
    expect(
      buildRunAckUserPrompt({
        intent: "completed",
        facts: { ...FACTS, producedQuantity: 2 },
      })
    ).toContain("Quantity produced: 2")
  })
})

describe("buildRunAckSystemPrompt", () => {
  it("names the partner's language", () => {
    expect(buildRunAckSystemPrompt("hi")).toContain("Hindi")
    expect(buildRunAckSystemPrompt("en")).toContain("English")
  })

  it("falls back to English for a language we do not have a name for", () => {
    expect(buildRunAckSystemPrompt("bn")).toContain("English")
  })
})

describe("isRunAckUsable — fails closed", () => {
  it("accepts a plain, short sentence", () => {
    expect(
      isRunAckUsable("Thanks for taking this on. Start it whenever you're ready.", FACTS)
    ).toBe(true)
  })

  it("rejects empty, blank and non-strings", () => {
    expect(isRunAckUsable("", FACTS)).toBe(false)
    expect(isRunAckUsable("   ", FACTS)).toBe(false)
    expect(isRunAckUsable(null, FACTS)).toBe(false)
    expect(isRunAckUsable(undefined, FACTS)).toBe(false)
    expect(isRunAckUsable(42, FACTS)).toBe(false)
  })

  it("rejects an essay", () => {
    expect(isRunAckUsable("a".repeat(RUN_ACK_MAX_CHARS + 1), FACTS)).toBe(false)
  })

  it("🔴 rejects a hallucinated identifier", () => {
    /*
     * The failure that matters. A message naming prod_run_XXXX reads as
     * authoritative and refers to nothing.
     */
    expect(
      isRunAckUsable("Got it — prod_run_01ZZZZZZZZZZZZ is yours now.", FACTS)
    ).toBe(false)
    expect(isRunAckUsable("Your order ordli_01ABCDEF is set.", FACTS)).toBe(false)
  })

  it("🔴 rejects a quantity the facts do not contain", () => {
    // Quantities decide money. 20 is not 2.
    expect(isRunAckUsable("Please make 20 pieces.", FACTS)).toBe(false)
  })

  it("allows a quantity that IS in the facts", () => {
    expect(isRunAckUsable("Both 2 pieces are confirmed.", FACTS)).toBe(true)
  })

  it("allows the produced quantity on a completion", () => {
    const facts = { ...FACTS, producedQuantity: 3 }
    expect(isRunAckUsable("You finished 3 of them, thank you.", facts)).toBe(true)
  })

  it("does not trip on digits inside a word", () => {
    expect(isRunAckUsable("Ready for the 2nd stage.", FACTS)).toBe(true)
  })
})

describe("composeRunAck", () => {
  it("appends the identifiers itself, so they cannot be wrong", () => {
    const out = composeRunAck("Thanks for taking this on.", FACTS)
    expect(out).toContain("Thanks for taking this on.")
    expect(out).toContain("*Run:* prod_run_01M22YXTZKQXBSD23MZAQBVRTE")
    expect(out).toContain("*Design:* Pashmina Inspired Tunic")
  })

  it("omits the design line when there is no design name", () => {
    const out = composeRunAck("Started.", { runId: "prod_run_1" })
    expect(out).not.toContain("*Design:*")
    expect(out).toContain("*Run:* prod_run_1")
  })
})
