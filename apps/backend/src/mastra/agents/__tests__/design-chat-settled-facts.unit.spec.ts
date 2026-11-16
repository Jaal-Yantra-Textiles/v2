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
 * stated back as given, and the standing "verify your email" instruction is
 * switched off once the maker is signed in (#2543 phase 2: the email is the
 * session's, never one typed into the chat).
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

  const SIGNED_IN: DesignChatContext = { signed_in: true, email: "maker@example.com" }

  it("states the SIGNED-IN email back as settled", () => {
    const plan = planDesignTurn([msg(ONBOARDING)], SIGNED_IN)

    expect(plan.signed_in).toBe(true)
    expect(plan.settled).toContain("maker@example.com")
    expect(plan.settled).toMatch(/Do NOT ask for an email/)
  })

  it("🔴 stops telling the model to ask for an email it already has", () => {
    const signedIn = buildDesignChatSystem(undefined, SIGNED_IN, [msg(ONBOARDING)])

    // The instruction that produced "just to confirm: is that the one?"
    expect(signedIn).not.toMatch(/they are NOT signed in/)
    expect(signedIn).toMatch(/signed in with a verified email/)

    // …and a guest is sent to the verify panel instead.
    const guest = buildDesignChatSystem(undefined, undefined, [msg("Design a kurta.")])
    expect(guest).toMatch(/they are NOT signed in/)
    expect(guest).not.toMatch(/signed in with a verified email/)
  })

  /**
   * #2543 phase 2: an email TYPED into the chat proves nothing. Treating it
   * as settled told the model the design would save under it — the exact
   * unverified-email path this phase closes.
   */
  it("🔴 a typed email is NOT settled and does not unlock create_design", () => {
    const plan = planDesignTurn([msg(ONBOARDING)])

    expect(plan.signed_in).toBe(false)
    expect(plan.settled).not.toContain("maker@example.com")
    expect(plan.directive).toMatch(/NOT SIGNED IN/)
    expect(plan.directive).toMatch(/Verify your email/)
    expect(plan.directive).not.toMatch(/call create_design \(once\)/)

    const prompt = buildDesignChatSystem(undefined, undefined, [msg(ONBOARDING)])
    expect(prompt).toMatch(/Do NOT ask them to type their email in the chat/)
  })

  it("🔴 forbids a second create_design once the design exists", () => {
    const context: DesignChatContext = {
      design_id: "design_01ABC",
      signed_in: true,
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
