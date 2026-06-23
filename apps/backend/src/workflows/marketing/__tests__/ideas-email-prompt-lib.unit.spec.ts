/**
 * Unit test — ideas-email prompt assembly (#659 slice 2, spec 02 §4.4/§8).
 * Pure: ground truth + voice in → prompt string out. No DI, no DB, no LLM.
 *
 * Run:
 *   TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern="ideas-email-prompt"
 */
import {
  buildIdeasPrompt,
  MARKETING_VOICE_RULES,
  STRICTER_SUFFIX,
} from "../ideas-email-prompt-lib"
import type { GroundTruth } from "../ideas-email-guard-lib"

const GT: GroundTruth = {
  date_ist: "2026-06-23",
  one_goal: "Grow GMV",
  values: [
    { token: "TODAY_GMV", value: 184320.5, display: "₹1,84,320", unit: "INR" },
    { token: "DELTA_DOD", value: 12.5, display: "+12.5%", unit: "percent" },
  ],
}

describe("buildIdeasPrompt", () => {
  const prompt = buildIdeasPrompt(GT, "JYT — textile production e-commerce")

  it("includes every ground-truth {TOKEN} placeholder", () => {
    expect(prompt).toContain("{TODAY_GMV}")
    expect(prompt).toContain("{DELTA_DOD}")
  })
  it("interpolates the date and the one goal", () => {
    expect(prompt).toContain("2026-06-23")
    expect(prompt).toContain("Grow GMV")
  })
  it("contains the placeholder-only hard rule", () => {
    expect(prompt).toContain("ONLY by its {TOKEN} placeholder")
    expect(prompt.toLowerCase()).toContain("never write a literal number")
  })
  it("includes the business description and the voice rules", () => {
    expect(prompt).toContain("JYT — textile production e-commerce")
    expect(prompt).toContain(MARKETING_VOICE_RULES.split("\n")[0])
  })
  it("is deterministic given the same input", () => {
    expect(buildIdeasPrompt(GT, "X")).toBe(buildIdeasPrompt(GT, "X"))
  })
  it("accepts a voice-rules override", () => {
    expect(buildIdeasPrompt(GT, "X", "TERSE ONLY")).toContain("TERSE ONLY")
  })
  it("handles an empty ground-truth value set gracefully", () => {
    const p = buildIdeasPrompt({ ...GT, values: [] }, "X")
    expect(p).toContain("(no metrics available)")
  })
})

describe("STRICTER_SUFFIX", () => {
  it("reinforces the placeholder-only rule for the regenerate attempt", () => {
    expect(STRICTER_SUFFIX.toLowerCase()).toContain("placeholder")
    expect(STRICTER_SUFFIX.toLowerCase()).toContain("forbidden")
  })
})
