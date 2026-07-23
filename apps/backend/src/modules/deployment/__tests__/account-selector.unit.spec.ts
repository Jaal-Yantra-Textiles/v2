import {
  remainingCapacity,
  isFull,
  isEligible,
  selectDeploymentAccount,
  decideProvisionTarget,
  resolveProvisioningMode,
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

describe("deployment account-selector — provisioning mode (shared vs dedicated)", () => {
  it("defaults to dedicated when nothing is configured", () => {
    expect(resolveProvisioningMode("vercel", {})).toEqual({
      mode: "dedicated",
      sharedProjectId: null,
      sharedProjectName: null,
    })
  })

  it("Netlify is ALWAYS dedicated, even with a shared_project_id set", () => {
    expect(
      resolveProvisioningMode("netlify", {
        apiConfig: { shared_project_id: "site_123", shared_project_name: "shared" },
      })
    ).toEqual({ mode: "dedicated", sharedProjectId: null, sharedProjectName: null })
  })

  it("goes shared from the account api_config (name defaults to id)", () => {
    expect(
      resolveProvisioningMode("vercel", {
        apiConfig: { shared_project_id: "prj_shared" },
      })
    ).toEqual({
      mode: "shared",
      sharedProjectId: "prj_shared",
      sharedProjectName: "prj_shared",
    })
  })

  it("api_config carries both id and name", () => {
    expect(
      resolveProvisioningMode("render", {
        apiConfig: { shared_project_id: "srv_1", shared_project_name: "storefront-shared" },
      })
    ).toEqual({
      mode: "shared",
      sharedProjectId: "srv_1",
      sharedProjectName: "storefront-shared",
    })
  })

  it("falls back to the <PROVIDER>_SHARED_PROJECT_ID env on the legacy env path", () => {
    expect(
      resolveProvisioningMode("vercel", {
        env: {
          VERCEL_SHARED_PROJECT_ID: "prj_env",
          VERCEL_SHARED_PROJECT_NAME: "storefront-shared",
        },
      })
    ).toEqual({
      mode: "shared",
      sharedProjectId: "prj_env",
      sharedProjectName: "storefront-shared",
    })
  })

  it("Cloudflare accepts the worker name as the shared project id", () => {
    expect(
      resolveProvisioningMode("cloudflare", {
        env: { CLOUDFLARE_SHARED_WORKER_NAME: "nextjs-starter-medusa" },
      })
    ).toEqual({
      mode: "shared",
      sharedProjectId: "nextjs-starter-medusa",
      sharedProjectName: "nextjs-starter-medusa",
    })
  })

  it("account api_config wins over env", () => {
    expect(
      resolveProvisioningMode("vercel", {
        apiConfig: { shared_project_id: "prj_acct" },
        env: { VERCEL_SHARED_PROJECT_ID: "prj_env" },
      }).sharedProjectId
    ).toBe("prj_acct")
  })
})
