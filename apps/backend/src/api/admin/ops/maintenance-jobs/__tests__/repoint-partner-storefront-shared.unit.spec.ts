import { decideRepointAction } from "../repoint-partner-storefront-shared-job"

const SHARED = "prj_shared"

describe("repoint-partner-storefront-shared — decideRepointAction", () => {
  it("repoints a partner still on its dedicated project", () => {
    expect(
      decideRepointAction(
        { hosting_provider: "vercel", deployment_project_id: "prj_dedicated" },
        SHARED
      )
    ).toBe("repoint")
  })

  it("skips a partner already on the shared project (idempotent)", () => {
    expect(
      decideRepointAction(
        { hosting_provider: "vercel", deployment_project_id: SHARED },
        SHARED
      )
    ).toBe("already_shared")
  })

  it("treats a pre-#884 null provider as vercel and repoints via vercel_project_id", () => {
    expect(
      decideRepointAction(
        { hosting_provider: null, vercel_project_id: "prj_old" },
        SHARED
      )
    ).toBe("repoint")
  })

  it("skips non-Vercel partners (cloudflare/render/netlify)", () => {
    expect(
      decideRepointAction(
        { hosting_provider: "cloudflare", deployment_project_id: "wk_x" },
        SHARED
      )
    ).toBe("not_vercel")
  })

  it("skips an unprovisioned partner (no project ref)", () => {
    expect(decideRepointAction({ hosting_provider: "vercel" }, SHARED)).toBe(
      "not_provisioned"
    )
  })

  it("prefers deployment_project_id over vercel_project_id for the current ref", () => {
    // already migrated in the generic column but legacy col stale → already_shared
    expect(
      decideRepointAction(
        { hosting_provider: "vercel", deployment_project_id: SHARED, vercel_project_id: "prj_old" },
        SHARED
      )
    ).toBe("already_shared")
  })
})
