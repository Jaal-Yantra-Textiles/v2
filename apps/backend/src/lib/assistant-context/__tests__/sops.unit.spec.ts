import { describe, it, expect } from "@jest/globals"
import {
  buildSystemPrompt,
  domainSop,
  ADMIN_BASE_PROMPT,
  PARTNER_BASE_PROMPT,
} from "../index"

describe("assistant-context: buildSystemPrompt", () => {
  it("always includes the base", () => {
    const p = buildSystemPrompt("admin", { domains: [], hasImages: false })
    expect(p).toContain("You are the JYT admin assistant")
    expect(p).toContain("## Safety rails")
  })

  it("keeps the base free of the moved SOPs", () => {
    // The point of the split: the situational sections must NOT ride on the
    // always-on base, or they are still sent on every request.
    expect(ADMIN_BASE_PROMPT).not.toContain("## Turning an idea into a design")
    expect(ADMIN_BASE_PROMPT).not.toContain("## Images the operator attaches")
    expect(PARTNER_BASE_PROMPT).not.toContain("## Creating a product from photos")
    expect(PARTNER_BASE_PROMPT).not.toContain("## Photos the partner shares")
  })

  it("omits the image SOP and domain SOPs when they are not relevant", () => {
    const p = buildSystemPrompt("admin", { domains: ["orders"], hasImages: false })
    expect(p).not.toContain("## Images the operator attaches")
    expect(p).not.toContain("## Turning an idea into a design")
  })

  it("injects the image SOP only when an image is attached", () => {
    expect(buildSystemPrompt("admin", { domains: [], hasImages: true })).toContain(
      "## Images the operator attaches"
    )
    expect(buildSystemPrompt("admin", { domains: [], hasImages: false })).not.toContain(
      "## Images the operator attaches"
    )
  })

  it("injects the admin design SOP only for the designs domain", () => {
    expect(buildSystemPrompt("admin", { domains: ["designs"], hasImages: false })).toContain(
      "## Turning an idea into a design"
    )
    expect(buildSystemPrompt("admin", { domains: ["orders"], hasImages: false })).not.toContain(
      "## Turning an idea into a design"
    )
  })

  it("injects the partner catalog SOP only for the catalog domain", () => {
    const catalog = buildSystemPrompt("partner", { domains: ["catalog"], hasImages: true })
    expect(catalog).toContain("## Creating a product from photos")
    expect(catalog).toContain("## Photos the partner shares")

    const money = buildSystemPrompt("partner", { domains: ["money"], hasImages: false })
    expect(money).not.toContain("## Creating a product from photos")
    expect(money).not.toContain("## Photos the partner shares")
  })

  it("ignores domains it has no SOP for", () => {
    const p = buildSystemPrompt("admin", { domains: ["money", "bogus"], hasImages: false })
    expect(p).toContain("## Safety rails")
    expect(p).not.toContain("## Turning an idea into a design")
  })

  it("domainSop returns the SOP for a domain and undefined otherwise", () => {
    expect(domainSop("admin", "designs")).toContain("## Turning an idea into a design")
    expect(domainSop("admin", "orders")).toBeUndefined()
    expect(domainSop("partner", "catalog")).toContain("## Creating a product from photos")
    expect(domainSop("partner", "money")).toBeUndefined()
  })
})