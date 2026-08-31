import {
  buildDesignChatSystem,
  planDesignTurn,
  type DesignChatContext,
} from "../storefront-design-chat"

/**
 * #1689 — "there's a lot of asking going on."
 *
 * The founder's onboarding sent, in one message:
 *
 *   Design a kurta. Save my designs to <email>.
 *
 * and the assistant replied asking *which email to save it under*. Both facts
 * were in the message that prompted the question.
 *
 * These assert the SETTLED block: what the record already establishes is
 * stated back as given, and the standing "ask for their email early"
 * instruction is switched off once there is nothing to ask for.
 *
 * ⚠️ Each assertion below was checked against the pre-fix prompt and FAILED
 * there — the settled block did not exist and the email instruction was
 * unconditional. A prompt test that passes either way tests nothing.
 */
const msg = (text: string) => ({
  role: "user",
  parts: [{ type: "text", text }],
})

describe("design chat — settled facts", () => {
  const ONBOARDING = "Design a kurta. Save my designs to maker@example.com."

  it("states an email given in the transcript back as settled", () => {
    const plan = planDesignTurn([msg(ONBOARDING)])

    expect(plan.has_email).toBe(true)
    expect(plan.settled).toContain("maker@example.com")
    expect(plan.settled).toMatch(/Do NOT ask for it/)
  })

  it("🔴 stops telling the model to ask for an email it already has", () => {
    const withEmail = buildDesignChatSystem(undefined, undefined, [
      msg(ONBOARDING),
    ])

    // The instruction that produced "just to confirm: is that the one?"
    expect(withEmail).not.toMatch(/ask for it EARLY/)
    expect(withEmail).toMatch(/already in hand/)

    // …and it is still asked for when it genuinely has not been given.
    const withoutEmail = buildDesignChatSystem(undefined, undefined, [
      msg("Design a kurta."),
    ])
    expect(withoutEmail).toMatch(/ask for it EARLY/)
    expect(withoutEmail).not.toMatch(/already in hand/)
  })

  it("🔴 forbids a second create_design once the design exists", () => {
    const context: DesignChatContext = {
      design_id: "design_01ABC",
      email: "maker@example.com",
      design: {
        name: "Post-Industrial Trousers",
        status: "Conceptual",
        product_type: "trousers",
        concept_theme: "post-industrial",
        aesthetic_keywords: ["utilitarian", "raw"],
        color_palette: ["indigo"],
      },
    }
    const plan = planDesignTurn([msg("Design a kurta.")], context)

    expect(plan.settled).toContain("design_01ABC")
    expect(plan.settled).toMatch(/Do NOT call create_design again/)
    // The turn plan must not be asking for it at the same time.
    expect(plan.directive).toMatch(/Do NOT call create_design again/)
    expect(plan.directive).not.toMatch(/call create_design \(once\)/)
  })

  it("carries the agreed brief so it is not renegotiated", () => {
    const plan = planDesignTurn([msg("hello")], {
      design_id: "design_01ABC",
      design: {
        product_type: "saree",
        concept_theme: "monsoon indigo",
        aesthetic_keywords: ["handwoven", "drapey"],
        color_palette: ["indigo", "ecru"],
      },
    })

    expect(plan.settled).toMatch(/saree/)
    expect(plan.settled).toMatch(/monsoon indigo/)
    expect(plan.settled).toMatch(/handwoven, drapey/)
    expect(plan.settled).toMatch(/indigo, ecru/)
  })

  it("emits nothing when nothing is settled — a first turn stays open", () => {
    expect(planDesignTurn([msg("hi")]).settled).toBe("")
  })

  /**
   * 🔑 The block is the model's memory of its own tool calls, because the
   * chat route strips every tool part out of the history before the model
   * sees it. If that sentence goes, the model has no reason to believe the
   * block over the transcript.
   */
  it("says why the block exists — the model cannot see its own tool calls", () => {
    const plan = planDesignTurn([msg("Design a kurta for maker@example.com")])
    expect(plan.settled).toMatch(/cannot see your own earlier tool calls/)
    expect(plan.settled).toMatch(/PREFER ACTING OVER ASKING/)
  })
})
