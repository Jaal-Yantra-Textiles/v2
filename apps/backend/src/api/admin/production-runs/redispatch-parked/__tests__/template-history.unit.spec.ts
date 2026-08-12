import {
  recoverRunTemplates,
  resolveDispatchTemplates,
} from "../template-history"

/**
 * The redispatch endpoint shipped believing this was unanswerable — "tasks do
 * not carry their template". They do: `createTaskWithTemplates` stamps
 * `template_id` and `template_name` on every task it instantiates. Checked
 * against prod 2026-08-12: all 7 parked runs recovered, across 4 DIFFERENT
 * template sets, which is why recovery is per run and never pooled.
 */
describe("recoverRunTemplates", () => {
  const task = (
    templateName: string | null,
    templateId: string | null = null,
    status = "cancelled"
  ) => ({
    id: `task_${templateName ?? "parent"}`,
    status,
    metadata: templateName
      ? { template_name: templateName, template_id: templateId }
      : { workflow_type: "production_run" },
  })

  it("recovers the live case: one parked run, one template", () => {
    // prod_run_01KMYY7XVR6XVHW39YXMY6CKX0 -> Sampling.
    const h = recoverRunTemplates([
      task(null),
      task("Sampling", "01JSV5QCNDEY73Q3RK1EHSE44K"),
    ])

    expect(h.source).toBe("tasks")
    expect(h.templates).toEqual([
      { name: "Sampling", template_id: "01JSV5QCNDEY73Q3RK1EHSE44K" },
    ])
  })

  it("includes cancelled tasks — every task on a parked run is cancelled", () => {
    // Excluding them would recover nothing for exactly the runs this serves.
    const h = recoverRunTemplates([task("Stitching", "t_1", "cancelled")])

    expect(h.templates.map((t) => t.name)).toEqual(["Stitching"])
  })

  it("keeps the order the partner works in rather than sorting", () => {
    const h = recoverRunTemplates([
      task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
      task("Embroidery and Painting", "01KMMTZTEDBQXPMSFDV5N16CE7"),
    ])

    expect(h.templates.map((t) => t.name)).toEqual([
      "Stitching",
      "Embroidery and Painting",
    ])
  })

  it("skips the parent task, which is created directly and carries no stamp", () => {
    expect(recoverRunTemplates([task(null)]).templates).toEqual([])
  })

  it("collapses the same template instantiated twice into one choice", () => {
    const h = recoverRunTemplates([task("Sampling", "t_1"), task("Sampling", "t_1")])

    expect(h.templates).toHaveLength(1)
  })

  it("keeps two same-named templates apart when their ids differ", () => {
    // Prod really has two rows called "Stitching". They are different processes.
    const h = recoverRunTemplates([
      task("Stitching", "01JW0Y600VQPWGMCBZXSGNZW67"),
      task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
    ])

    expect(h.templates).toHaveLength(2)
  })

  it("falls back to the approval intent when nothing was ever instantiated", () => {
    const h = recoverRunTemplates([], {
      dispatch_template_names: ["Sampling"],
    })

    expect(h.source).toBe("run_dispatch_intent")
    expect(h.templates).toEqual([{ name: "Sampling", template_id: null }])
  })

  it("prefers what actually happened over what was intended", () => {
    // Intent is what someone meant to dispatch; tasks are proof of what ran.
    const h = recoverRunTemplates([task("Cutting", "t_cut")], {
      dispatch_template_names: ["Sampling"],
    })

    expect(h.source).toBe("tasks")
    expect(h.templates.map((t) => t.name)).toEqual(["Cutting"])
  })

  it("reports 'none' rather than inventing a selection", () => {
    const h = recoverRunTemplates([task(null)], { dispatch_template_names: [] })

    expect(h).toEqual({ templates: [], source: "none", ambiguous_names: [] })
  })

  it("flags a recovered name that matches more than one template", () => {
    // Dispatch resolves by NAME, so this one may instantiate the other row.
    const h = recoverRunTemplates(
      [task("Stitching", "01K5S31SPKSW31S7XP3TYY296F")],
      null,
      { templateNameCounts: new Map([["Stitching", 2], ["Sampling", 1]]) }
    )

    expect(h.ambiguous_names).toEqual(["Stitching"])
  })

  it("does not flag a name that is unique", () => {
    const h = recoverRunTemplates([task("Sampling", "t_1")], null, {
      templateNameCounts: new Map([["Sampling", 1]]),
    })

    expect(h.ambiguous_names).toEqual([])
  })

  it("survives a task with no metadata at all", () => {
    expect(recoverRunTemplates([{ id: "t" } as any]).templates).toEqual([])
  })
})

/**
 * Which templates a run actually goes out with. The safety property mirrors
 * `previous_partner_id`: recovered history is applied PER RUN, so a batch whose
 * runs used different sets cannot be flattened onto one of them by accident.
 */
describe("resolveDispatchTemplates", () => {
  const history = (names: string[]) => ({
    templates: names.map((name) => ({ name, template_id: `id_${name}` })),
    source: "tasks" as const,
    ambiguous_names: [],
  })

  it("uses the run's own history when asked", () => {
    expect(
      resolveDispatchTemplates(history(["Sampling"]), { usePrevious: true })
    ).toEqual({ template_names: ["Sampling"], source: "tasks" })
  })

  it("lets an explicit selection override history — a decision beats a record", () => {
    expect(
      resolveDispatchTemplates(history(["Sampling"]), {
        explicit: ["Cutting"],
        usePrevious: true,
      })
    ).toEqual({ template_names: ["Cutting"], source: "explicit" })
  })

  it("does NOT use history unless asked, so a plain call still parks the run", () => {
    // Silently dispatching from history would send work to a partner off a
    // guess. Recovery informs the operator; it does not decide for them.
    expect(resolveDispatchTemplates(history(["Sampling"]), {})).toEqual({
      template_names: [],
      source: "none",
    })
  })

  it("parks the run when there is no history to use", () => {
    expect(
      resolveDispatchTemplates(
        { templates: [], source: "none", ambiguous_names: [] },
        { usePrevious: true }
      )
    ).toEqual({ template_names: [], source: "none" })
  })

  it("labels an intent-sourced selection as intent, not as fact", () => {
    const r = resolveDispatchTemplates(
      {
        templates: [{ name: "Sampling", template_id: null }],
        source: "run_dispatch_intent",
        ambiguous_names: [],
      },
      { usePrevious: true }
    )

    expect(r.source).toBe("run_dispatch_intent")
  })

  it("gives each run its own set rather than pooling the batch", () => {
    // The prod shape: 7 runs, 4 different sets.
    const runs = [history(["Sampling"]), history(["Stitching", "Quality Check"])]
    const resolved = runs.map((h) =>
      resolveDispatchTemplates(h, { usePrevious: true }).template_names
    )

    expect(resolved).toEqual([["Sampling"], ["Stitching", "Quality Check"]])
  })

  it("copies the names rather than aliasing the history", () => {
    const h = history(["Sampling"])
    const r = resolveDispatchTemplates(h, { usePrevious: true })
    r.template_names.push("Injected")

    expect(h.templates.map((t) => t.name)).toEqual(["Sampling"])
  })
})
