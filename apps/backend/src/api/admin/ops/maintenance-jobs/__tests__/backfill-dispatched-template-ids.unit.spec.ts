import { deriveDispatchedTemplateIds } from "../backfill-dispatched-template-ids-job"

/**
 * #1265. Runs dispatched before `dispatched_template_ids` existed have no
 * record, so their tasks are the only evidence. This is the reading of those
 * tasks — and the rule that a PARTIAL reading is refused rather than written,
 * because a short list claims the run ran a shorter process than it did.
 */
describe("deriveDispatchedTemplateIds", () => {
  const task = (template_name: string | null, template_id: string | null = null) => ({
    metadata: template_name
      ? { template_name, template_id }
      : { workflow_type: "production_run" },
  })

  it("reads the live case: prod_run_01KYP9VVJ1VMSW1PGVXKGTDSCH → Stitching (Production)", () => {
    const { ids, unidentified } = deriveDispatchedTemplateIds([
      task(null), // the parent production-run task, unstamped
      task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
    ])

    expect(ids).toEqual(["01K5S31SPKSW31S7XP3TYY296F"])
    expect(unidentified).toEqual([])
  })

  it("keeps the order the partner works in", () => {
    const { ids } = deriveDispatchedTemplateIds([
      task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
      task("Quality Check", "01KMQ7R0NQGN50B7PSJZBSE1FQ"),
    ])

    expect(ids).toEqual([
      "01K5S31SPKSW31S7XP3TYY296F",
      "01KMQ7R0NQGN50B7PSJZBSE1FQ",
    ])
  })

  it("collapses the same template instantiated twice", () => {
    const { ids } = deriveDispatchedTemplateIds([
      task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
      task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
    ])

    expect(ids).toHaveLength(1)
  })

  it("skips the parent task, which carries no stamp", () => {
    const { ids, unidentified } = deriveDispatchedTemplateIds([task(null)])

    expect(ids).toEqual([])
    expect(unidentified).toEqual([])
  })

  it("reports a task that names a template without identifying one", () => {
    // The whole reason the job skips rather than records: this run's answer is
    // partial, and half of it is not a smaller truth — it is a wrong one.
    const { ids, unidentified } = deriveDispatchedTemplateIds([
      task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
      task("Cutting", null),
    ])

    expect(ids).toEqual(["01K5S31SPKSW31S7XP3TYY296F"])
    expect(unidentified).toEqual(["Cutting"])
  })

  it("survives tasks with no metadata at all", () => {
    const { ids, unidentified } = deriveDispatchedTemplateIds([
      {},
      { metadata: null },
    ] as any)

    expect(ids).toEqual([])
    expect(unidentified).toEqual([])
  })

  it("ignores a non-string stamp rather than trusting it", () => {
    const { ids, unidentified } = deriveDispatchedTemplateIds([
      { metadata: { template_name: "Stitching", template_id: 123 } },
    ] as any)

    expect(ids).toEqual([])
    expect(unidentified).toEqual(["Stitching"])
  })

  it("returns nothing for a run with no tasks", () => {
    expect(deriveDispatchedTemplateIds([])).toEqual({
      ids: [],
      unidentified: [],
    })
  })
})
