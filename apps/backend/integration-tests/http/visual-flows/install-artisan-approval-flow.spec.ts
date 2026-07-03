import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { installArtisanProductApprovalFlowJob } from "../../../src/api/admin/ops/maintenance-jobs/registry"
import { VISUAL_FLOWS_MODULE } from "../../../src/modules/visual_flows"

jest.setTimeout(120 * 1000)

// #859 S2 (#861) — the Data Plumbing "Install artisan product review email flow"
// job exercises createCompleteFlow with the real FLOW_DEF (single source of
// truth with the CLI seed). This proves the FLOW_DEF graph shape is accepted by
// the visual_flows service — the main risk in authoring a flow by hand.
//
// ONE test on purpose: the medusa integration runner TRUNCATEs between tests and
// that reset can deadlock against the @medusajs/index CONCURRENTLY sync.
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  it("installs the artisan review email flow idempotently as a draft", async () => {
    const container = getContainer()
    const service: any = container.resolve(VISUAL_FLOWS_MODULE)

    // 1. Dry-run: previews, writes nothing.
    const preview = await installArtisanProductApprovalFlowJob.run(container, {
      dry_run: true,
      params: {},
    } as any)
    expect(preview.applied).toBe(false)
    expect(preview.summary).toMatch(/would create/i)
    expect((await service.listVisualFlows({ name: "Artisan Product Review — Email" })).length).toBe(0)

    // 2. Apply: creates the flow.
    const applied = await installArtisanProductApprovalFlowJob.run(container, {
      dry_run: false,
      params: {},
    } as any)
    expect(applied.applied).toBe(true)

    const [flow] = await service.listVisualFlows({
      name: "Artisan Product Review — Email",
    })
    expect(flow).toBeTruthy()
    expect(flow.status).toBe("draft")
    expect(flow.trigger_type).toBe("event")
    expect(flow.trigger_config?.event_types).toEqual([
      "partner_product.approved",
      "partner_product.rejected",
    ])

    // 3. Re-apply: idempotent — refuses to overwrite.
    const again = await installArtisanProductApprovalFlowJob.run(container, {
      dry_run: false,
      params: {},
    } as any)
    expect(again.applied).toBe(false)
    expect(again.summary).toMatch(/already installed/i)
  })
})
