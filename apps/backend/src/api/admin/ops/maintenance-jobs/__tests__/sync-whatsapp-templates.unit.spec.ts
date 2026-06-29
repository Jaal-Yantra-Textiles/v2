import { buildSyncTemplatesResult } from "../registry"
import type { SyncTemplateResult } from "../../../../../scripts/whatsapp-templates/meta-template-sync"

const base = (over: Partial<SyncTemplateResult> = {}): SyncTemplateResult => ({
  platformsUsed: [{ id: "p1", label: "JYT IN" }],
  platformsSkipped: [],
  toCreate: [],
  existing: [],
  created: [],
  errors: [],
  listErrors: [],
  ...over,
})

const action = (name: string, language: string) => ({
  platformId: "p1",
  platformLabel: "JYT IN",
  name,
  language,
  kind: "create" as const,
})

describe("buildSyncTemplatesResult", () => {
  it("dry-run previews missing variants, writes nothing", () => {
    const sync = base({
      toCreate: [action("jyt_inventory_order_status_v1", "en")],
      existing: [{ ...action("jyt_payment_submission_paid_v1", "en"), kind: "exists" as const }],
    })
    const r = buildSyncTemplatesResult("sync-whatsapp-templates", true, sync)
    expect(r.applied).toBe(false)
    expect(r.summary).toMatch(/dry-run/i)
    expect(r.summary).toContain("Nothing written")
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0].entity).toBe("whatsapp_template")
    expect((r.changes[0].after as any).status).toBe("(would create)")
  })

  it("apply reports created variants as PENDING and marks applied", () => {
    const sync = base({
      toCreate: [action("jyt_inventory_order_status_v1", "en")],
      created: [{ platformId: "p1", name: "jyt_inventory_order_status_v1", language: "en", id: "tpl_1" }],
      existing: [{ ...action("x", "en"), kind: "exists" as const }],
    })
    const r = buildSyncTemplatesResult("sync-whatsapp-templates", false, sync)
    expect(r.applied).toBe(true)
    expect(r.summary).toMatch(/Submitted 1/)
    expect((r.changes[0].after as any).status).toBe("PENDING")
    expect((r.changes[0].after as any).meta_template_id).toBe("tpl_1")
    expect(r.errors).toBeUndefined()
  })

  it("apply surfaces per-variant create errors and stays not-applied when nothing created", () => {
    const sync = base({
      errors: [{ platformId: "p1", name: "jyt_inventory_order_status_v1", language: "en", message: "code=132000 msg=mismatch" }],
    })
    const r = buildSyncTemplatesResult("sync-whatsapp-templates", false, sync)
    expect(r.applied).toBe(false)
    expect(r.summary).toMatch(/1 failed/)
    expect(r.errors).toHaveLength(1)
    expect(r.errors![0].message).toContain("mismatch")
  })

  it("notes skipped (no waba/token) and unreadable platforms", () => {
    const sync = base({
      platformsSkipped: [{ id: "p2", reason: "no_waba_id" }],
      listErrors: [{ platformId: "p3", message: "HTTP 401" }],
    })
    const r = buildSyncTemplatesResult("sync-whatsapp-templates", true, sync)
    expect(r.summary).toMatch(/Skipped 1 platform/)
    expect(r.summary).toMatch(/unreadable/)
  })

  it("flags when there are no usable platforms at all", () => {
    const sync = base({ platformsUsed: [] })
    const r = buildSyncTemplatesResult("sync-whatsapp-templates", true, sync)
    expect(r.summary).toMatch(/No usable WhatsApp platforms/)
  })
})
