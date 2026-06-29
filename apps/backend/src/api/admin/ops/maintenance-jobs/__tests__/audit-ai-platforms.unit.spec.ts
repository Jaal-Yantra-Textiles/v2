import { auditAiPlatformsJob, MAINTENANCE_JOBS } from "../registry"

/**
 * #756 — job-level tests for the AI-platform coverage audit. The pure
 * report/plan logic is covered in ai-platform-sweep-lib.unit.spec.ts; here we
 * exercise the job's container wiring (sweep → report → optional normalize)
 * with a fake socials service. No DB.
 */

type FakeRow = {
  id: string
  category?: string
  status?: string
  metadata?: Record<string, any>
  api_config?: Record<string, any>
}

const makeContainer = (rows: FakeRow[], updates: any[]) => {
  const socials = {
    listSocialPlatforms: async (filters: any = {}) => {
      if (filters?.id) return rows.filter((r) => r.id === filters.id)
      // sweep call: category=ai (+ status=active unless includeInactive)
      return rows.filter((r) => r.category === "ai")
    },
    updateSocialPlatforms: async (payload: any) => {
      updates.push(payload)
      return payload
    },
  }
  return {
    resolve: (_key: string) => socials,
  } as any
}

const aiRow = (over: Partial<FakeRow> & { id: string }): FakeRow => ({
  category: "ai",
  status: "active",
  metadata: { role: "ai_search_chat" },
  api_config: { api_key: "sk-secret", default_model: "qwen-plus" },
  ...over,
})

describe("auditAiPlatformsJob", () => {
  it("is registered in MAINTENANCE_JOBS", () => {
    expect(MAINTENANCE_JOBS).toContain(auditAiPlatformsJob)
    expect(auditAiPlatformsJob.id).toBe("audit-ai-platforms")
  })

  it("dry-run reports coverage and writes nothing", async () => {
    const updates: any[] = []
    const container = makeContainer(
      [aiRow({ id: "p1", metadata: { role: "ai_search_chat", is_default: true } })],
      updates
    )
    const res = await auditAiPlatformsJob.run(container, {
      dry_run: true,
      params: {},
    })
    expect(updates).toHaveLength(0)
    expect(res.applied).toBe(false)
    expect(res.summary).toContain("known AI roles configured")
    // one coverage row per known role (6)
    expect(res.changes.filter((c) => c.field === "coverage")).toHaveLength(6)
    // no secret leaked into the coverage payload
    expect(JSON.stringify(res.changes)).not.toContain("sk-secret")
  })

  it("dry-run flags a planned default fix without applying it", async () => {
    const updates: any[] = []
    // sole usable platform for the role, not marked default → plannable
    const container = makeContainer(
      [aiRow({ id: "p1", metadata: { role: "ai_newsletter_drafter" } })],
      updates
    )
    const res = await auditAiPlatformsJob.run(container, {
      dry_run: true,
      params: {},
    })
    expect(updates).toHaveLength(0)
    expect(res.applied).toBe(false)
    expect(res.summary).toContain("would be set")
  })

  it("apply marks the sole usable platform default (merging metadata)", async () => {
    const updates: any[] = []
    const container = makeContainer(
      [
        aiRow({
          id: "p1",
          metadata: { role: "ai_newsletter_drafter", note: "keep-me" },
        }),
      ],
      updates
    )
    const res = await auditAiPlatformsJob.run(container, {
      dry_run: false,
      params: {},
    })
    expect(res.applied).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      selector: { id: "p1" },
      data: { metadata: { role: "ai_newsletter_drafter", note: "keep-me", is_default: true } },
    })
    // mutation surfaced as a change row
    expect(
      res.changes.some(
        (c) => c.field === "metadata.is_default" && c.id === "p1" && c.after === true
      )
    ).toBe(true)
  })

  it("apply is a no-op when defaults are already set", async () => {
    const updates: any[] = []
    const container = makeContainer(
      [aiRow({ id: "p1", metadata: { role: "ai_search_chat", is_default: true } })],
      updates
    )
    const res = await auditAiPlatformsJob.run(container, {
      dry_run: false,
      params: {},
    })
    expect(updates).toHaveLength(0)
    expect(res.applied).toBe(false)
  })
})
