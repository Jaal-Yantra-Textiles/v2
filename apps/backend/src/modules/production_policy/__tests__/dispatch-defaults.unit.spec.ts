import {
  DEFAULT_DISPATCH_DEFAULTS,
  defaultPolicyConfig,
  isUsableDispatchDefault,
  mergePolicyConfig,
  missingPolicyKeys,
  resolveDispatchDefault,
} from "../policy-config"

/*
 * #2202 — the standing answer for "what do we dispatch this with" when the
 * cloth lands and nobody chose.
 *
 * Every assertion here decides whether a PARTNER IS MESSAGED and given tasks,
 * so the bias throughout is: when in doubt, dispatch nothing.
 */

const STITCH = "01K5S31SPKSW31S7XP3TYY296F" // Stitching (Production)
const QC = "01KMQ7R0NQGN50B7PSJZBSE1FQ" // Quality Check
const SAMPLING = "01JSV5QCNDEY73Q3RK1EHSE44K" // Sampling (Pre Production)

describe("dispatch defaults — the policy shape", () => {
  it("ships EMPTY, so nothing dispatches itself until someone writes a rule", () => {
    expect(DEFAULT_DISPATCH_DEFAULTS).toEqual([])
    expect(defaultPolicyConfig().dispatch_defaults).toEqual([])
    expect(resolveDispatchDefault(defaultPolicyConfig().dispatch_defaults, {
      run_type: "production",
      product_type: "robe",
    })).toBeNull()
  })

  it("is NOT reported as a missing section — an empty default enforces nothing", () => {
    /*
     * `sections` means "rules in force that your stored row has never heard
     * of", which is why it exists: the screen showed fewer rules than were
     * actually gating approve/dispatch/accept. The dispatch default is empty by
     * design, so an absent section is not a hidden rule — warning about it
     * would say a rule applies when none does.
     */
    expect(missingPolicyKeys({ transitions: {} }).sections).not.toContain(
      "dispatch_defaults"
    )
    expect(missingPolicyKeys({}).sections).toEqual(["transitions", "reassignment"])
  })

  it("carries stored rules through the merge EXACTLY as saved", () => {
    /*
     * Including a malformed one. The settings screen must show what the
     * operator saved; `resolveDispatchDefault` is what refuses to act on it.
     * A merge that quietly dropped it would show fewer rules than are stored —
     * the very failure policy-config exists to end.
     */
    const stored = {
      dispatch_defaults: [
        { when: { run_type: "production" }, template_ids: [STITCH] },
        { when: {}, template_ids: [] },
      ],
    }
    expect(mergePolicyConfig(stored).dispatch_defaults).toEqual(
      stored.dispatch_defaults
    )
  })
})

describe("isUsableDispatchDefault — fails CLOSED", () => {
  it("accepts a well-formed rule", () => {
    expect(
      isUsableDispatchDefault({ when: { run_type: "production" }, template_ids: [STITCH] })
    ).toBe(true)
  })

  it.each([
    ["no template_ids", { when: { run_type: "production" } }],
    ["empty template_ids", { when: { run_type: "production" }, template_ids: [] }],
    ["a non-string id", { when: { run_type: "production" }, template_ids: [1] }],
    ["an empty-string id", { when: { run_type: "production" }, template_ids: [""] }],
    ["no when", { template_ids: [STITCH] }],
    ["an empty when", { when: {}, template_ids: [STITCH] }],
    ["an unknown match key", { when: { partner_id: "p1" }, template_ids: [STITCH] }],
    ["a non-string match value", { when: { run_type: 3 }, template_ids: [STITCH] }],
    ["an array for when", { when: [], template_ids: [STITCH] }],
    ["null", null],
  ])("refuses %s", (_label, rule) => {
    expect(isUsableDispatchDefault(rule)).toBe(false)
  })

  it("an empty `when` is refused — it would match EVERY job", () => {
    /*
     * The dangerous one. A catch-all rule reached through the release branch
     * would dispatch every dependency-released run alike, whatever it is.
     */
    expect(
      resolveDispatchDefault([{ when: {}, template_ids: [STITCH] }], {
        run_type: "sample",
        product_type: "robe",
      })
    ).toBeNull()
  })
})

describe("resolveDispatchDefault — matching", () => {
  const RULES = [
    { when: { run_type: "production" }, template_ids: [STITCH] },
    { when: { run_type: "sample" }, template_ids: [SAMPLING] },
    {
      when: { run_type: "production", product_type: "robe" },
      template_ids: [STITCH, QC],
    },
  ]

  it("matches on run_type alone", () => {
    expect(
      resolveDispatchDefault(RULES, { run_type: "production", product_type: "scarf" })
    ).toEqual([STITCH])
  })

  it("prefers the MORE SPECIFIC rule regardless of write order", () => {
    // The robe rule is written last but names two keys, so it wins.
    expect(
      resolveDispatchDefault(RULES, { run_type: "production", product_type: "robe" })
    ).toEqual([STITCH, QC])
  })

  it("requires EVERY key a rule names to match", () => {
    /*
     * A rule is a claim about a kind of job; a half-matching claim is not a
     * claim about THIS job. A sample robe must not inherit the production robe
     * rule.
     */
    expect(
      resolveDispatchDefault(
        [{ when: { run_type: "production", product_type: "robe" }, template_ids: [QC] }],
        { run_type: "sample", product_type: "robe" }
      )
    ).toBeNull()
  })

  it("returns null when nothing matches, rather than the first rule", () => {
    expect(
      resolveDispatchDefault(RULES, { run_type: "rework", product_type: "robe" })
    ).toBeNull()
  })

  it("treats a missing product_type as unmatched, not as a wildcard", () => {
    // A run whose design could not be read still matches a run_type-only rule…
    expect(
      resolveDispatchDefault(RULES, { run_type: "production", product_type: null })
    ).toEqual([STITCH])
    // …but never one that names a product_type.
    expect(
      resolveDispatchDefault(
        [{ when: { product_type: "robe" }, template_ids: [QC] }],
        { run_type: "production", product_type: null }
      )
    ).toBeNull()
  })

  it("ignores malformed rules but still honours the good ones beside them", () => {
    expect(
      resolveDispatchDefault(
        [
          { when: { run_type: "production" }, template_ids: [] },
          { when: { run_type: "production" }, template_ids: [STITCH] },
        ],
        { run_type: "production", product_type: "robe" }
      )
    ).toEqual([STITCH])
  })

  it("hands back a COPY, so a caller cannot mutate the stored policy", () => {
    const rules = [{ when: { run_type: "production" }, template_ids: [STITCH] }]
    const got = resolveDispatchDefault(rules, { run_type: "production" })!
    got.push(QC)
    expect(rules[0].template_ids).toEqual([STITCH])
  })

  it("survives junk where the rule list should be", () => {
    for (const junk of [null, undefined, "nope", 7, {}]) {
      expect(resolveDispatchDefault(junk, { run_type: "production" })).toBeNull()
    }
  })
})
