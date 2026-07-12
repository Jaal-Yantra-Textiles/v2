import { decideHostingBackfillAction } from "../backfill-partner-hosting-provider-job"

describe("decideHostingBackfillAction", () => {
  it("skips partners with no vercel project (never provisioned)", () => {
    expect(decideHostingBackfillAction({ vercel_project_id: null })).toBe("not_provisioned")
    expect(decideHostingBackfillAction({})).toBe("not_provisioned")
  })

  it("stamps a pre-#884 vercel partner (vercel_* set, generic cols null)", () => {
    expect(
      decideHostingBackfillAction({
        vercel_project_id: "prj_1",
        hosting_provider: null,
        deployment_project_id: null,
      })
    ).toBe("stamp")
  })

  it("treats a fully-stamped partner as already backfilled (no account asked)", () => {
    expect(
      decideHostingBackfillAction({
        vercel_project_id: "prj_1",
        hosting_provider: "vercel",
        deployment_project_id: "prj_1",
      })
    ).toBe("already_backfilled")
  })

  it("re-stamps when an account is requested but not yet attached", () => {
    expect(
      decideHostingBackfillAction(
        {
          vercel_project_id: "prj_1",
          hosting_provider: "vercel",
          deployment_project_id: "prj_1",
          deployment_account_id: null,
        },
        { accountId: "dep_acct_9" }
      )
    ).toBe("stamp")
  })

  it("is idempotent once the requested account is attached", () => {
    expect(
      decideHostingBackfillAction(
        {
          vercel_project_id: "prj_1",
          hosting_provider: "vercel",
          deployment_project_id: "prj_1",
          deployment_account_id: "dep_acct_9",
        },
        { accountId: "dep_acct_9" }
      )
    ).toBe("already_backfilled")
  })

  it("stamps when provider set but generic project id missing (partial legacy)", () => {
    expect(
      decideHostingBackfillAction({
        vercel_project_id: "prj_1",
        hosting_provider: "vercel",
        deployment_project_id: null,
      })
    ).toBe("stamp")
  })
})
