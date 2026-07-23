import { syncPartnerRunWhatsAppFlowJob } from "../registry"

/**
 * Fake container whose resolve() always returns the given visual-flows service
 * mock (the job only resolves VISUAL_FLOWS_MODULE).
 */
const fakeContainer = (service: any) => ({ resolve: () => service })

describe("sync-partner-run-whatsapp-flow (#1093) — install/replace job", () => {
  it("dry-run against an existing flow → reports REPLACE, writes nothing", async () => {
    const update = jest.fn()
    const create = jest.fn()
    const service = {
      listVisualFlows: jest.fn().mockResolvedValue([{ id: "vf_1", status: "active" }]),
      updateCompleteFlow: update,
      createCompleteFlow: create,
    }
    const res = await syncPartnerRunWhatsAppFlowJob.run(
      fakeContainer(service) as any,
      { dry_run: true } as any
    )
    expect(res.applied).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(res.summary).toMatch(/Would REPLACE/)
    expect(res.summary).toContain("vf_1")
    expect(res.changes[0].field).toBe("replaced")
  })

  it("apply against an existing flow → updateCompleteFlow in place, status preserved", async () => {
    // Capture args via the impl (avoids .mock.calls' `unknown` typing under
    // the strict prod-build tsconfig).
    let updateId: string | undefined
    let updatePayload: Record<string, any> | undefined
    const update = jest.fn((id: string, payload: Record<string, any>) => {
      updateId = id
      updatePayload = payload
      return Promise.resolve({ id })
    })
    const create = jest.fn()
    const service = {
      listVisualFlows: jest.fn().mockResolvedValue([{ id: "vf_1", status: "active" }]),
      updateCompleteFlow: update,
      createCompleteFlow: create,
    }
    const res = await syncPartnerRunWhatsAppFlowJob.run(
      fakeContainer(service) as any,
      { dry_run: false } as any
    )
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateId).toBe("vf_1")
    // never overwrites the flow's name or live status
    expect(updatePayload).not.toHaveProperty("status")
    expect(updatePayload).not.toHaveProperty("name")
    expect(res.applied).toBe(true)
    expect(res.summary).toMatch(/Replaced/)
    expect((res.changes[0].after as any).status_preserved).toBe("active")
  })

  it("apply with no existing flow → createCompleteFlow as draft", async () => {
    const update = jest.fn()
    const create = jest.fn().mockResolvedValue({ id: "vf_new" })
    const service = {
      listVisualFlows: jest.fn().mockResolvedValue([]),
      updateCompleteFlow: update,
      createCompleteFlow: create,
    }
    const res = await syncPartnerRunWhatsAppFlowJob.run(
      fakeContainer(service) as any,
      { dry_run: false } as any
    )
    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    expect(res.applied).toBe(true)
    expect(res.changes[0].field).toBe("created")
    expect(res.summary).toMatch(/Created/)
  })
})
