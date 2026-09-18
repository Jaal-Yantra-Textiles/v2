import {
  isFreeformChatEnabled,
  formatPartnerContext,
  formatConversationHistory,
  buildFreeformSystemPrompt,
  buildUserPrompt,
  type PartnerChatContext,
  type HistoryEntry,
} from "../whatsapp-freeform-prompt"

describe("isFreeformChatEnabled", () => {
  const ORIGINAL = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it("is false by default", () => {
    delete process.env.WHATSAPP_FREEFORM_CHAT_ENABLED
    expect(isFreeformChatEnabled()).toBe(false)
  })

  it("accepts common truthy forms", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      process.env.WHATSAPP_FREEFORM_CHAT_ENABLED = v
      expect(isFreeformChatEnabled()).toBe(true)
    }
  })

  it("rejects anything else", () => {
    for (const v of ["0", "false", "no", "", "   "]) {
      process.env.WHATSAPP_FREEFORM_CHAT_ENABLED = v
      expect(isFreeformChatEnabled()).toBe(false)
    }
  })
})

describe("formatPartnerContext", () => {
  it("renders designs, runs and payments", () => {
    const ctx: PartnerChatContext = {
      designs: [
        { id: "design_1", name: "Indigo Kurta", status: "In_Development", product_type: "kurta" },
      ],
      openRuns: [
        { id: "prod_run_1", status: "in_progress", accepted: true, designName: "Indigo Kurta" },
      ],
      pendingPayments: [{ id: "psub_1", status: "Pending", totalAmount: 121777, currency: "INR" }],
    }
    const out = formatPartnerContext(ctx)
    expect(out).toContain("design_1")
    expect(out).toContain("In_Development")
    expect(out).toContain("prod_run_1")
    expect(out).toContain("accepted")
    expect(out).toContain("psub_1")
  })

  it("renders empty sections explicitly", () => {
    const out = formatPartnerContext({ designs: [], openRuns: [], pendingPayments: [] })
    expect(out).toContain("Designs: none on record.")
    expect(out).toContain("Production runs: none currently open.")
  })
})

describe("formatConversationHistory", () => {
  it("maps partner/bot roles and returns a fallback when empty", () => {
    expect(formatConversationHistory([])).toBe("(no prior messages)")

    const entries: HistoryEntry[] = [
      { role: "bot", content: "Hi, this is SS from JYT" },
      { role: "partner", content: "getting ready" },
    ]
    const out = formatConversationHistory(entries)
    expect(out).toBe("You: Hi, this is SS from JYT\nPartner: getting ready")
  })
})

describe("buildFreeformSystemPrompt", () => {
  it("includes agent name, partner name, context and language instruction", () => {
    const system = buildFreeformSystemPrompt({
      agentName: "SS",
      partnerName: "Priya",
      language: "en",
      contextText: "Designs:\n- Indigo Kurta",
    })
    expect(system).toContain("You are SS")
    expect(system).toContain("Priya")
    expect(system).toContain("Indigo Kurta")
    expect(system).toContain("Reply in Hinglish — Hindi written in Roman letters")
  })

  it("instructs Hinglish for a hi-language partner", () => {
    const system = buildFreeformSystemPrompt({
      partnerName: "Priya",
      language: "hi",
      contextText: "(no open work on record)",
    })
    expect(system).toContain("The partner chose Hindi. Reply in Hinglish")
  })

  it("defaults the agent name to the env-provided identity", () => {
    const system = buildFreeformSystemPrompt({
      partnerName: "Priya",
      contextText: "x",
    })
    expect(system).toContain("You are SS")
  })
})

describe("buildUserPrompt", () => {
  it("includes the transcript and the incoming message", () => {
    const out = buildUserPrompt({
      historyText: "You: Hi there",
      partnerName: "Priya",
      incomingText: "getting ready",
    })
    expect(out).toContain("You: Hi there")
    expect(out).toContain("Priya just wrote:")
    expect(out).toContain("getting ready")
  })
})