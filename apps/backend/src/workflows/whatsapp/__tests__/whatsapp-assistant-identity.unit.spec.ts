import { buildFreeformSystemPrompt } from "../whatsapp-freeform-prompt"

/**
 * What the assistant says when a partner asks who it is.
 *
 * Partners do ask — "who is this?", "are you a real person?", "where are you?"
 * — and until this landed the prompt said nothing about it, so the model
 * improvised around the initials "SS". An invented persona is the worst of the
 * available answers: not the truth, not a real contact, and different every
 * time.
 *
 * These tests pin the shape of the answer, not its wording: name the business,
 * name the real human contact, and never merge the two.
 */

const build = (over: Record<string, any> = {}) =>
  buildFreeformSystemPrompt({
    partnerName: "Sharlho",
    contextText: "(no open work)",
    ...over,
  })

describe("assistant identity in the free-form prompt", () => {
  it("names the real contact a partner is put through to", () => {
    expect(build({ contactName: "Saransh" })).toContain("Saransh")
  })

  it("defaults the contact from env rather than leaving it unnamed", () => {
    // The default exists so the question always has an answer, even in an
    // environment nobody configured.
    const prompt = build()
    expect(prompt).toMatch(/who you are, when they ask/i)
    expect(prompt).not.toMatch(/\$\{contactName\}/)
    expect(prompt).not.toMatch(/undefined/)
  })

  it("forbids claiming to BE the contact, and forbids signing off as them", () => {
    const prompt = build({ contactName: "Saransh" })
    expect(prompt).toContain("do not claim to be Saransh")
    expect(prompt).toContain("do not sign off as Saransh")
  })

  it("forbids claiming to be a human and inventing colleagues", () => {
    const prompt = build()
    expect(prompt).toContain("Never claim to be a human")
    expect(prompt).toContain("never invent a colleague who does not exist")
  })

  it("answers WHERE as well as WHO", () => {
    expect(build({ businessLocation: "Dharamshala, India" })).toContain(
      "Dharamshala, India"
    )
  })

  it("still forbids inventing a surname, role or office", () => {
    expect(build()).toContain("never invent a surname, a role or an office")
  })

  it("keeps the partner's own name unchanged alongside the contact", () => {
    // The partner name and the contact name are different people and must not
    // be confused for each other — the prompt already forbids renaming the
    // partner, and adding a second name must not weaken that.
    const prompt = build({ contactName: "Saransh" })
    expect(prompt).toContain("The partner's name is Sharlho")
    expect(prompt).toContain("Saransh")
  })

  it("interpolates a custom agent name without losing the contact", () => {
    const prompt = build({ agentName: "Asha", contactName: "Saransh" })
    expect(prompt).toContain("You are Asha, the production assistant")
    expect(prompt).toContain("Saransh is the person here")
  })
})

describe("small talk", () => {
  it("tells the assistant to answer a greeting rather than pivot to work", () => {
    const prompt = build()
    expect(prompt).toMatch(/# Small talk/)
    expect(prompt).toContain("do not pivot straight into their production runs")
  })

  it("keeps the honesty rule inside small talk too", () => {
    // The warm path is exactly where a model is most tempted to invent a day,
    // a lunch and a personality. The identity rules must not stop at the
    // work conversation.
    expect(build()).toContain("you do not have a day or a lunch")
  })

  it("caps the length so pleasantries do not read as a machine trying", () => {
    expect(build()).toContain("Keep it to one or two lines")
  })
})
