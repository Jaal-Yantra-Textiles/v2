import {
  remainingCapacity,
  isFull,
  isEligible,
  selectDeploymentAccount,
  decideProvisionTarget,
  type DeploymentAccountRow,
} from "../account-selector"

const acct = (o: Partial<DeploymentAccountRow>): DeploymentAccountRow => ({
  id: o.id || "a", provider: o.provider || "vercel", label: o.label || "a",
  cutoff_max: o.cutoff_max, project_count: o.project_count, priority: o.priority, status: o.status,
})

describe("deployment account-selector — capacity", () => {
  it("remainingCapacity respects cap; uncapped = Infinity", () => {
    expect(remainingCapacity(acct({ cutoff_max: 10, project_count: 7 }))).toBe(3)
    expect(remainingCapacity(acct({ cutoff_max: null, project_count: 999 }))).toBe(Infinity)
    expect(remainingCapacity(acct({ cutoff_max: 5, project_count: 5 }))).toBe(0)
  })
  it("isFull / isEligible", () => {
    expect(isFull(acct({ cutoff_max: 5, project_count: 5 }))).toBe(true)
    expect(isEligible(acct({ cutoff_max: 5, project_count: 5 }))).toBe(false)
    expect(isEligible(acct({ status: "inactive", cutoff_max: 10, project_count: 0 }))).toBe(false)
    expect(isEligible(acct({ status: "active", cutoff_max: 10, project_count: 2 }))).toBe(true)
  })
})

describe("deployment account-selector — selection", () => {
  it("picks the least-loaded eligible account", () => {
    const pick = selectDeploymentAccount([
      acct({ id: "v1", project_count: 8, cutoff_max: 10 }),
      acct({ id: "v2", project_count: 3, cutoff_max: 10 }),
      acct({ id: "v3", project_count: 5, cutoff_max: 10 }),
    ])
    expect(pick?.id).toBe("v2")
  })

  it("skips full and inactive accounts", () => {
    const pick = selectDeploymentAccount([
      acct({ id: "full", project_count: 10, cutoff_max: 10 }),
      acct({ id: "off", status: "inactive", project_count: 0, cutoff_max: 10 }),
      acct({ id: "ok", project_count: 9, cutoff_max: 10 }),
    ])
    expect(pick?.id).toBe("ok")
  })

  it("returns null when every account is full/inactive (add or round-up)", () => {
    expect(
      selectDeploymentAccount([
        acct({ id: "a", project_count: 10, cutoff_max: 10 }),
        acct({ id: "b", status: "full", project_count: 0, cutoff_max: 10 }),
      ])
    ).toBeNull()
  })

  it("filters by provider", () => {
    const pick = selectDeploymentAccount(
      [
        acct({ id: "v", provider: "vercel", project_count: 0 }),
        acct({ id: "cf", provider: "cloudflare", project_count: 2 }),
      ],
      { provider: "cloudflare" }
    )
    expect(pick?.id).toBe("cf")
  })

  it("tiebreaks equal load by priority then headroom", () => {
    const pick = selectDeploymentAccount([
      acct({ id: "lo", project_count: 2, cutoff_max: 10, priority: 0 }),
      acct({ id: "hi", project_count: 2, cutoff_max: 20, priority: 5 }),
    ])
    expect(pick?.id).toBe("hi")
  })
})

describe("decideProvisionTarget — rotation + env fallback", () => {
  it("prefers a least-loaded account of the preferred provider", () => {
    const t = decideProvisionTarget(
      [
        acct({ id: "cf1", provider: "cloudflare", project_count: 4, cutoff_max: 10 }),
        acct({ id: "cf2", provider: "cloudflare", project_count: 1, cutoff_max: 10 }),
        acct({ id: "v1", provider: "vercel", project_count: 0, cutoff_max: 10 }),
      ],
      { preferredProvider: "cloudflare", envProviders: ["vercel"] }
    )
    expect(t).toEqual({ kind: "account", accountId: "cf2", provider: "cloudflare" })
  })

  it("spills to another provider's account when the preferred pool is full", () => {
    const t = decideProvisionTarget(
      [
        acct({ id: "cf1", provider: "cloudflare", project_count: 10, cutoff_max: 10 }),
        acct({ id: "nl1", provider: "netlify", project_count: 2, cutoff_max: 10 }),
      ],
      { preferredProvider: "cloudflare", envProviders: [] }
    )
    expect(t).toEqual({ kind: "account", accountId: "nl1", provider: "netlify" })
  })

  it("falls back to the preferred env provider when no accounts exist", () => {
    const t = decideProvisionTarget([], {
      preferredProvider: "cloudflare",
      envProviders: ["vercel", "cloudflare"],
    })
    expect(t).toEqual({ kind: "env", provider: "cloudflare" })
  })

  it("falls back to the first env provider when preferred has no env creds", () => {
    const t = decideProvisionTarget([], {
      preferredProvider: "cloudflare",
      envProviders: ["vercel"],
    })
    expect(t).toEqual({ kind: "env", provider: "vercel" })
  })

  it("returns null when no accounts and no env providers (capacity exhausted)", () => {
    expect(
      decideProvisionTarget(
        [acct({ id: "cf1", provider: "cloudflare", project_count: 10, cutoff_max: 10 })],
        { preferredProvider: "cloudflare", envProviders: [] }
      )
    ).toBeNull()
  })
})
