import {
  DEFAULT_TRANSITIONS,
  defaultPolicyConfig,
  mergePolicyConfig,
  missingPolicyKeys,
} from "../policy-config"

/** The shape prod actually stores: 4 of the 9 transition keys, no reassignment. */
const PROD_SHAPED_CONFIG = {
  transitions: {
    accept_from: ["sent_to_partner"],
    approve_from: ["draft", "pending_review"],
    dispatch_from: ["approved"],
    send_to_production_from: ["approved"],
  },
}

describe("mergePolicyConfig", () => {
  it("fills in transition keys the stored row has never heard of", () => {
    const merged = mergePolicyConfig(PROD_SHAPED_CONFIG)

    expect(Object.keys(merged.transitions).sort()).toEqual(
      Object.keys(DEFAULT_TRANSITIONS).sort()
    )
    // The five that prod is missing today.
    expect(merged.transitions.start_work_from).toEqual(["in_progress"])
    expect(merged.transitions.finish_work_from).toEqual(["in_progress"])
    expect(merged.transitions.complete_work_from).toEqual(["in_progress"])
    expect(merged.transitions.decline_from).toContain("sent_to_partner")
    expect(merged.transitions.assign_partner_from).toContain(
      "awaiting_reassignment"
    )
  })

  it("supplies the whole reassignment block when it is absent", () => {
    // This is the mechanism behind the inert auto-accept switch: the key isn't
    // stored, so the switch always read the default no matter what was shown.
    const merged = mergePolicyConfig(PROD_SHAPED_CONFIG)
    expect(merged.reassignment).toEqual({
      same_partner_retries: 1,
      auto_accept_on_retry: false,
    })
  })

  it("lets a stored value win over the default", () => {
    const merged = mergePolicyConfig({
      transitions: { approve_from: ["draft"] },
      reassignment: { same_partner_retries: 3, auto_accept_on_retry: true },
    })
    expect(merged.transitions.approve_from).toEqual(["draft"])
    expect(merged.reassignment).toEqual({
      same_partner_retries: 3,
      auto_accept_on_retry: true,
    })
  })

  it("honours an empty array — 'nothing may do this' is a real policy", () => {
    // The trap: treating [] as falsy would silently re-open a transition an
    // operator deliberately closed, which is the most dangerous possible
    // direction for a merge to be wrong in.
    const merged = mergePolicyConfig({ transitions: { approve_from: [] } })
    expect(merged.transitions.approve_from).toEqual([])
  })

  it("ignores malformed stored values rather than propagating them", () => {
    const merged = mergePolicyConfig({
      transitions: { approve_from: "draft" as any },
    })
    expect(merged.transitions.approve_from).toEqual(
      DEFAULT_TRANSITIONS.approve_from
    )
  })

  it("keeps unknown keys instead of silently discarding an operator's edit", () => {
    const merged = mergePolicyConfig({
      transitions: { future_from: ["draft"] },
      something_else: { enabled: true },
    })
    expect(merged.transitions.future_from).toEqual(["draft"])
    expect(merged.something_else).toEqual({ enabled: true })
  })

  it("returns the full defaults for an empty or missing config", () => {
    expect(mergePolicyConfig(null)).toEqual(defaultPolicyConfig())
    expect(mergePolicyConfig({})).toEqual(defaultPolicyConfig())
  })

  it("coerces a nonsense retry count back to the default", () => {
    expect(
      mergePolicyConfig({ reassignment: { same_partner_retries: -2 } })
        .reassignment.same_partner_retries
    ).toBe(1)
    expect(
      mergePolicyConfig({ reassignment: { same_partner_retries: "many" } })
        .reassignment.same_partner_retries
    ).toBe(1)
    // 0 is meaningful — cap then park immediately — and must survive.
    expect(
      mergePolicyConfig({ reassignment: { same_partner_retries: 0 } })
        .reassignment.same_partner_retries
    ).toBe(0)
  })
})

describe("missingPolicyKeys", () => {
  it("names exactly what prod is running on defaults", () => {
    const missing = missingPolicyKeys(PROD_SHAPED_CONFIG)
    expect(missing.transitions.sort()).toEqual(
      [
        "assign_partner_from",
        "complete_work_from",
        "decline_from",
        "finish_work_from",
        "start_work_from",
      ].sort()
    )
    expect(missing.sections).toEqual(["reassignment"])
  })

  it("reports nothing missing for a fully-populated config", () => {
    const missing = missingPolicyKeys(defaultPolicyConfig())
    expect(missing.transitions).toEqual([])
    expect(missing.sections).toEqual([])
  })

  it("reports both sections missing for an empty config", () => {
    const missing = missingPolicyKeys({})
    expect(missing.sections).toEqual(["transitions", "reassignment"])
    expect(missing.transitions).toHaveLength(
      Object.keys(DEFAULT_TRANSITIONS).length
    )
  })
})
