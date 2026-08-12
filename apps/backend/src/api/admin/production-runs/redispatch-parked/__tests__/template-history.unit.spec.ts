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
/**
 * The prod catalogue, trimmed. The point of it is the last two rows: "Stitching"
 * exists TWICE and the two differ ONLY by category — Pre Production vs
 * Production. They are different stages of the process wearing the same label,
 * so a bare name does not identify a template.
 */
const CATALOG = [
  {
    id: "01JSV5QCNDEY73Q3RK1EHSE44K",
    name: "Sampling",
    category_name: "Pre Production",
  },
  {
    id: "01KMMTZTEDBQXPMSFDV5N16CE7",
    name: "Embroidery and Painting",
    category_name: "Pre Production",
  },
  {
    id: "01KMQ7R0NQGN50B7PSJZBSE1FQ",
    name: "Quality Check",
    category_name: "Production",
  },
  { id: "ship_1", name: "ship-to-next-location", category_name: null },
  {
    id: "01JW0Y600VQPWGMCBZXSGNZW67",
    name: "Stitching",
    category_name: "Pre Production",
  },
  {
    id: "01K5S31SPKSW31S7XP3TYY296F",
    name: "Stitching",
    category_name: "Production",
  },
]

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
      {
        name: "Sampling",
        template_id: "01JSV5QCNDEY73Q3RK1EHSE44K",
        category_name: null,
      },
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
    expect(h.templates).toEqual([
      { name: "Sampling", template_id: null, category_name: null },
    ])
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
      { catalog: CATALOG }
    )

    expect(h.ambiguous_names).toEqual(["Stitching"])
  })

  it("does not flag a name that is unique", () => {
    const h = recoverRunTemplates([task("Sampling", "t_1")], null, {
      catalog: CATALOG,
    })

    expect(h.ambiguous_names).toEqual([])
  })

  it("survives a task with no metadata at all", () => {
    expect(recoverRunTemplates([{ id: "t" } as any]).templates).toEqual([])
  })

  describe("category is what actually identifies a template", () => {
    it("names the category the run really used, not just the label", () => {
      // The three parked runs using "Stitching" used the PRODUCTION one. Saying
      // only "Stitching" hides the entire distinction.
      const h = recoverRunTemplates(
        [task("Stitching", "01K5S31SPKSW31S7XP3TYY296F")],
        null,
        { catalog: CATALOG }
      )

      expect(h.templates).toEqual([
        {
          name: "Stitching",
          template_id: "01K5S31SPKSW31S7XP3TYY296F",
          category_name: "Production",
        },
      ])
    })

    it("distinguishes the two Stitchings by category, not by name", () => {
      const h = recoverRunTemplates(
        [
          task("Stitching", "01JW0Y600VQPWGMCBZXSGNZW67"),
          task("Stitching", "01K5S31SPKSW31S7XP3TYY296F"),
        ],
        null,
        { catalog: CATALOG }
      )

      expect(h.templates.map((t) => t.category_name)).toEqual([
        "Pre Production",
        "Production",
      ])
    })

    it("leaves the category null for a template no longer in the catalogue", () => {
      // A deleted template must read as unidentified, never as uncategorised.
      const h = recoverRunTemplates([task("Ghost", "gone_1")], null, {
        catalog: CATALOG,
      })

      expect(h.templates[0]).toEqual({
        name: "Ghost",
        template_id: "gone_1",
        category_name: null,
      })
    })

    it("carries a genuinely uncategorised template through as null", () => {
      const h = recoverRunTemplates([task("ship-to-next-location", "ship_1")], null, {
        catalog: CATALOG,
      })

      expect(h.templates[0].category_name).toBeNull()
    })

    it("identifies an intent-only name when exactly one template answers to it", () => {
      const h = recoverRunTemplates([], { dispatch_template_names: ["Sampling"] }, {
        catalog: CATALOG,
      })

      expect(h.templates[0]).toEqual({
        name: "Sampling",
        template_id: "01JSV5QCNDEY73Q3RK1EHSE44K",
        category_name: "Pre Production",
      })
    })

    it("refuses to identify an intent-only name that two templates answer to", () => {
      // Intent recorded a name and nothing else. Picking one of the two would
      // be inventing the stage the partner worked at.
      const h = recoverRunTemplates([], { dispatch_template_names: ["Stitching"] }, {
        catalog: CATALOG,
      })

      expect(h.templates[0]).toEqual({
        name: "Stitching",
        template_id: null,
        category_name: null,
      })
      expect(h.ambiguous_names).toEqual(["Stitching"])
    })

    it("claims no ambiguity when no catalogue was loaded, rather than asserting none", () => {
      // With nothing to compare against, "not ambiguous" would be a claim we
      // never checked.
      const h = recoverRunTemplates([task("Stitching", "01K5S31SPKSW31S7XP3TYY296F")])

      expect(h.ambiguous_names).toEqual([])
      expect(h.templates[0].category_name).toBeNull()
    })
  })
})

/**
 * Which templates a run actually goes out with. The safety property mirrors
 * `previous_partner_id`: recovered history is applied PER RUN, so a batch whose
 * runs used different sets cannot be flattened onto one of them by accident.
 */
describe("resolveDispatchTemplates", () => {
  const history = (names: string[]) => ({
    templates: names.map((name) => ({
      name,
      template_id: `id_${name}`,
      category_name: null,
    })),
    source: "tasks" as const,
    ambiguous_names: [],
  })

  it("uses the run's own history when asked", () => {
    expect(
      resolveDispatchTemplates(history(["Sampling"]), { usePrevious: true })
    ).toEqual({
      template_names: ["Sampling"],
      // #1261 — the recovered IDS travel with the names, so dispatch never
      // re-derives the template from a name that may match two rows.
      template_ids: ["id_Sampling"],
      source: "tasks",
      resolved_by: "id",
    })
  })

  it("lets an explicit selection override history — a decision beats a record", () => {
    expect(
      resolveDispatchTemplates(history(["Sampling"]), {
        explicit: ["Cutting"],
        usePrevious: true,
      })
    ).toEqual({
      template_names: ["Cutting"],
      template_ids: [],
      source: "explicit",
      resolved_by: "name",
    })
  })

  it("does NOT use history unless asked, so a plain call still parks the run", () => {
    // Silently dispatching from history would send work to a partner off a
    // guess. Recovery informs the operator; it does not decide for them.
    expect(resolveDispatchTemplates(history(["Sampling"]), {})).toEqual({
      template_names: [],
      template_ids: [],
      source: "none",
      resolved_by: "none",
    })
  })

  it("parks the run when there is no history to use", () => {
    expect(
      resolveDispatchTemplates(
        { templates: [], source: "none", ambiguous_names: [] },
        { usePrevious: true }
      )
    ).toEqual({
      template_names: [],
      template_ids: [],
      source: "none",
      resolved_by: "none",
    })
  })

  it("labels an intent-sourced selection as intent, not as fact", () => {
    const r = resolveDispatchTemplates(
      {
        templates: [
          { name: "Sampling", template_id: null, category_name: null },
        ],
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

  /**
   * #1261. Recovery correctly identifies WHICH "Stitching" a run used, and the
   * old resolver then threw that away by handing dispatch the bare name — which
   * looked it up again and could land on the other row. These pin the id
   * surviving all the way to the dispatch payload.
   */
  describe("#1261 — the recovered identity survives to dispatch", () => {
    it("sends ids when every recovered template is identified", () => {
      const r = resolveDispatchTemplates(
        {
          templates: [
            {
              name: "Stitching",
              template_id: "01K5S31S",
              category_name: "Production",
            },
          ],
          source: "tasks",
          ambiguous_names: ["Stitching"],
        },
        { usePrevious: true }
      )

      // The name is still carried for display, but `resolved_by: "id"` is what
      // says the ambiguous lookup will not run.
      expect(r.template_ids).toEqual(["01K5S31S"])
      expect(r.resolved_by).toBe("id")
    })

    it("falls back to names when a recovered template has NO id", () => {
      // Half-identified is not identified. An id list missing an entry would
      // dispatch a SHORTER process than the run actually used, which is worse
      // than falling back to a name that dispatch will now refuse if ambiguous.
      const r = resolveDispatchTemplates(
        {
          templates: [
            { name: "Sampling", template_id: "id_Sampling", category_name: null },
            { name: "Stitching", template_id: null, category_name: null },
          ],
          source: "run_dispatch_intent",
          ambiguous_names: [],
        },
        { usePrevious: true }
      )

      expect(r.template_ids).toEqual([])
      expect(r.template_names).toEqual(["Sampling", "Stitching"])
      expect(r.resolved_by).toBe("name")
    })

    it("prefers an explicit template_ids over an explicit template_names", () => {
      const r = resolveDispatchTemplates(history(["Sampling"]), {
        explicit: ["Cutting"],
        explicitIds: ["01K5S31S"],
        usePrevious: true,
      })

      expect(r).toEqual({
        template_names: [],
        template_ids: ["01K5S31S"],
        source: "explicit",
        resolved_by: "id",
      })
    })

    it("copies the ids rather than aliasing the caller's array", () => {
      const ids = ["01K5S31S"]
      const r = resolveDispatchTemplates(history(["Sampling"]), {
        explicitIds: ids,
      })
      r.template_ids.push("injected")

      expect(ids).toEqual(["01K5S31S"])
    })
  })
})
