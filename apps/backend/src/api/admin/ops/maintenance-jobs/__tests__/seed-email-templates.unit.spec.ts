import {
  buildEmailTemplateSeedResult,
  EMAIL_TEMPLATE_SETS,
  EMAIL_TEMPLATE_SET_KEYS,
  planEmailTemplateSeed,
  resolveEmailTemplateSpecs,
  seedEmailTemplatesJob,
  type EmailTemplateSpec,
} from "../seed-jobs"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"

/**
 * #457 Data Plumbing — pure logic for the `seed-email-templates` maintenance
 * job. The container-bound run() (listEmailTemplates + createEmailTemplates) is
 * thin; here we lock down the dry-run/apply decision, idempotent skip-existing,
 * set resolution + dedup, and the summary wording — no DB.
 */
describe("ops/maintenance-jobs seed-email-templates (#457)", () => {
  const specs: EmailTemplateSpec[] = [
    { template_key: "a", name: "Alpha" },
    { template_key: "b", name: "Beta" },
    { template_key: "c", name: "Gamma" },
  ]

  describe("planEmailTemplateSeed (idempotent partition)", () => {
    it("creates everything when nothing exists yet (empty admin)", () => {
      const plan = planEmailTemplateSeed(specs, new Set())
      expect(plan.total).toBe(3)
      expect(plan.toCreate.map((s) => s.template_key)).toEqual(["a", "b", "c"])
      expect(plan.existingKeys).toEqual([])
    })

    it("skips template_keys that already exist (re-run is a no-op)", () => {
      const plan = planEmailTemplateSeed(specs, new Set(["a", "c"]))
      expect(plan.toCreate.map((s) => s.template_key)).toEqual(["b"])
      expect(plan.existingKeys).toEqual(["a", "c"])
    })

    it("creates nothing when all exist", () => {
      const plan = planEmailTemplateSeed(specs, ["a", "b", "c"])
      expect(plan.toCreate).toEqual([])
      expect(plan.existingKeys).toEqual(["a", "b", "c"])
    })
  })

  describe("buildEmailTemplateSeedResult (wording + applied flag)", () => {
    it("dry-run reports would-create and is never marked applied", () => {
      const plan = planEmailTemplateSeed(specs, new Set(["a"]))
      const res = buildEmailTemplateSeedResult(
        "seed-email-templates",
        true,
        plan,
        "email templates"
      )
      expect(res.dry_run).toBe(true)
      expect(res.applied).toBe(false)
      expect(res.changes).toHaveLength(2)
      expect(res.changes[0]).toEqual({
        entity: "email_template",
        id: "b",
        field: "template_key",
        before: null,
        after: "Beta",
      })
      expect(res.summary).toBe(
        "Would create 2 of 3 email templates; 1 already exist"
      )
    })

    it("apply with new rows is marked applied", () => {
      const plan = planEmailTemplateSeed(specs, new Set())
      const res = buildEmailTemplateSeedResult(
        "seed-email-templates",
        false,
        plan,
        "email templates"
      )
      expect(res.applied).toBe(true)
      expect(res.summary).toBe(
        "Created 3 of 3 email templates; 0 already exist"
      )
    })

    it("apply with nothing to create is NOT marked applied (idempotent re-run)", () => {
      const plan = planEmailTemplateSeed(specs, ["a", "b", "c"])
      const res = buildEmailTemplateSeedResult(
        "seed-email-templates",
        false,
        plan,
        "email templates"
      )
      expect(res.applied).toBe(false)
      expect(res.changes).toEqual([])
      expect(res.summary).toBe(
        "Created 0 of 3 email templates; 3 already exist"
      )
    })

    it("falls back to template_key when a spec has no name", () => {
      const res = buildEmailTemplateSeedResult(
        "seed-email-templates",
        true,
        planEmailTemplateSeed([{ template_key: "x" }], new Set()),
        "email templates"
      )
      expect(res.changes[0].after).toBe("x")
    })
  })

  describe("resolveEmailTemplateSpecs (set selection + dedup)", () => {
    it("defaults to ALL sets when set is blank/undefined", () => {
      const all = resolveEmailTemplateSpecs(undefined)
      expect(all.setKeys).toEqual(EMAIL_TEMPLATE_SET_KEYS)
      const allEmpty = resolveEmailTemplateSpecs("")
      expect(allEmpty.setKeys).toEqual(EMAIL_TEMPLATE_SET_KEYS)
    })

    it("treats 'all' (any case) as every set", () => {
      expect(resolveEmailTemplateSpecs("ALL").setKeys).toEqual(
        EMAIL_TEMPLATE_SET_KEYS
      )
    })

    it("selects a single named set", () => {
      const r = resolveEmailTemplateSpecs("reengagement")
      expect(r.setKeys).toEqual(["reengagement"])
      expect(r.specs.length).toBeGreaterThan(0)
      expect(r.specs.every((s) => typeof s.template_key === "string")).toBe(true)
    })

    it("throws on an unknown set key", () => {
      expect(() => resolveEmailTemplateSpecs("nope")).toThrow(/Unknown email-template set/)
    })

    it("exposes the partner-email-verification template via the 'partner' set (#858 seeded through Data Plumbing, not a manual exec)", () => {
      const partner = resolveEmailTemplateSpecs("partner")
      expect(partner.specs.map((s) => s.template_key)).toContain(
        "partner-email-verification"
      )
      // …and therefore through the default "all" selection.
      const all = resolveEmailTemplateSpecs("all")
      expect(all.specs.map((s) => s.template_key)).toContain(
        "partner-email-verification"
      )
    })

    it("dedupes template_keys across sets so 'all' never lists a key twice", () => {
      const all = resolveEmailTemplateSpecs("all")
      const keys = all.specs.map((s) => s.template_key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it("every set carries at least one real template spec with a key", () => {
      for (const set of EMAIL_TEMPLATE_SETS) {
        expect(set.specs.length).toBeGreaterThan(0)
        for (const spec of set.specs) {
          expect(typeof spec.template_key).toBe("string")
          expect(spec.template_key.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe("registry wiring", () => {
    it("is registered in MAINTENANCE_JOBS and resolvable by id", () => {
      expect(MAINTENANCE_JOBS).toContain(seedEmailTemplatesJob)
      expect(getMaintenanceJob("seed-email-templates")).toBe(seedEmailTemplatesJob)
    })

    it("exposes set + overwrite + only params (all optional)", () => {
      expect(seedEmailTemplatesJob.params).toHaveLength(3)
      expect(seedEmailTemplatesJob.params.map((p) => p.name)).toEqual([
        "set",
        "overwrite",
        "only",
      ])
      expect(seedEmailTemplatesJob.params.every((p) => p.required === false)).toBe(true)
    })
  })

  describe("overwrite + only (redesign push)", () => {
    it("without overwrite, existing keys are skipped (no updates)", () => {
      const plan = planEmailTemplateSeed(specs, new Set(["a", "b", "c"]))
      expect(plan.toUpdate).toEqual([])
      expect(plan.existingKeys).toEqual(["a", "b", "c"])
    })

    it("overwrite routes existing keys to toUpdate instead of skipping", () => {
      const plan = planEmailTemplateSeed(specs, new Set(["a", "c"]), { overwrite: true })
      expect(plan.toCreate.map((s) => s.template_key)).toEqual(["b"])
      expect(plan.toUpdate.map((s) => s.template_key)).toEqual(["a", "c"])
      expect(plan.existingKeys).toEqual([])
    })

    it("only scopes the run to a single template_key", () => {
      const plan = planEmailTemplateSeed(specs, new Set(["a", "b", "c"]), {
        overwrite: true,
        only: "b",
      })
      expect(plan.total).toBe(1)
      expect(plan.toUpdate.map((s) => s.template_key)).toEqual(["b"])
      expect(plan.toCreate).toEqual([])
    })

    it("summary appends the update clause + is marked applied on overwrite", () => {
      const plan = planEmailTemplateSeed(specs, new Set(["a"]), { overwrite: true, only: "a" })
      const res = buildEmailTemplateSeedResult("seed-email-templates", false, plan, "email templates")
      expect(res.applied).toBe(true)
      expect(res.summary).toBe("Created 0 of 1 email templates; 0 already exist; updated 1")
      expect(res.changes).toEqual([
        { entity: "email_template", id: "a", field: "content", before: "(existing)", after: "Alpha" },
      ])
    })

    it("run() with overwrite+only updates the scoped template", async () => {
      const created: string[] = []
      const updated: string[] = []
      const reengagement = resolveEmailTemplateSpecs("reengagement").specs
      const key = reengagement[0].template_key
      const container = {
        resolve: () => ({
          listEmailTemplates: async () =>
            reengagement.map((s, i) => ({ id: `id_${i}`, template_key: s.template_key })),
          createEmailTemplates: async (rows: any[]) => {
            for (const r of rows) created.push(r.template_key)
            return rows
          },
          updateEmailTemplates: async (row: any) => {
            updated.push(row.template_key)
            return row
          },
        }),
      }
      const res = await seedEmailTemplatesJob.run(container, {
        dry_run: false,
        params: { set: "reengagement", overwrite: true, only: key },
      })
      expect(created).toEqual([])
      expect(updated).toEqual([key])
      expect(res.applied).toBe(true)
    })
  })

  describe("run() container branch (dry-run vs apply)", () => {
    const makeContainer = (existingKeys: string[], created: string[]) => ({
      resolve: () => ({
        listEmailTemplates: async () =>
          existingKeys.map((template_key) => ({ template_key })),
        createEmailTemplates: async (rows: any[]) => {
          for (const r of rows) created.push(r.template_key)
          return rows
        },
      }),
    })

    it("dry-run writes nothing", async () => {
      const created: string[] = []
      const container = makeContainer([], created)
      const res = await seedEmailTemplatesJob.run(container, {
        dry_run: true,
        params: { set: "reengagement" },
      })
      expect(created).toEqual([])
      expect(res.dry_run).toBe(true)
      expect(res.applied).toBe(false)
      expect(res.changes.length).toBeGreaterThan(0)
    })

    it("apply creates only the missing template_keys", async () => {
      const created: string[] = []
      const reengagement = resolveEmailTemplateSpecs("reengagement").specs
      const existing = [reengagement[0].template_key] // first already present
      const container = makeContainer(existing, created)
      const res = await seedEmailTemplatesJob.run(container, {
        dry_run: false,
        params: { set: "reengagement" },
      })
      // created everything except the one that already existed
      expect(created).toEqual(
        reengagement.slice(1).map((s) => s.template_key)
      )
      expect(res.applied).toBe(true)
    })

    it("re-run after apply is a no-op (idempotent)", async () => {
      const created: string[] = []
      const reengagement = resolveEmailTemplateSpecs("reengagement").specs
      const container = makeContainer(
        reengagement.map((s) => s.template_key),
        created
      )
      const res = await seedEmailTemplatesJob.run(container, {
        dry_run: false,
        params: { set: "reengagement" },
      })
      expect(created).toEqual([])
      expect(res.applied).toBe(false)
    })
  })
})
