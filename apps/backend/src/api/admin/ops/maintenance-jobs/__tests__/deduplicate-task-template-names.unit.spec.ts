import { planTemplateNameDeduplication } from "../deduplicate-task-template-names-job"

/**
 * The prod pair this job exists for: two "Stitching" rows differing ONLY by
 * category. Pre Production is the older row, Production the newer one — and the
 * three parked runs used the Production one.
 */
const PROD = [
  {
    id: "01JW0Y60",
    name: "Stitching",
    category_name: "Pre Production",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "01K5S31S",
    name: "Stitching",
    category_name: "Production",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    id: "01JW0Y61",
    name: "Sampling",
    category_name: "Pre Production",
    created_at: "2026-01-01T00:00:00.000Z",
  },
]

describe("planTemplateNameDeduplication", () => {
  it("keeps the OLDEST row's claim on the name and qualifies the rest", () => {
    // Oldest, because the fewest existing references change meaning that way.
    const plan = planTemplateNameDeduplication(PROD)

    expect(plan).toEqual([
      {
        id: "01K5S31S",
        category_name: "Production",
        before: "Stitching",
        after: "Stitching (Production)",
        kept_id: "01JW0Y60",
      },
    ])
  })

  it("renames the named category instead when asked", () => {
    // The prod call: keep "Stitching" pointing at Production (what the parked
    // runs used) and qualify the Pre Production row.
    const plan = planTemplateNameDeduplication(PROD, {
      renameCategory: "Pre Production",
    })

    expect(plan).toEqual([
      {
        id: "01JW0Y60",
        category_name: "Pre Production",
        before: "Stitching",
        after: "Stitching (Pre Production)",
        kept_id: "01K5S31S",
      },
    ])
  })

  it("plans nothing when every name already identifies one template", () => {
    expect(planTemplateNameDeduplication(PROD.slice(1))).toEqual([])
  })

  it("narrows to one name when asked", () => {
    const plan = planTemplateNameDeduplication(
      [
        ...PROD,
        {
          id: "c1",
          name: "Cutting",
          category_name: "Pre Production",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "c2",
          name: "Cutting",
          category_name: "Production",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
      { name: "Cutting" }
    )

    expect(plan.map((p) => p.id)).toEqual(["c2"])
  })

  it("does not let two renames in one pass collide with each other", () => {
    // Three rows of one name: qualifying by category alone would produce two
    // identical names when two of them share a category.
    const plan = planTemplateNameDeduplication([
      { id: "a", name: "Stitching", category_name: "Production", created_at: "2026-01-01" },
      { id: "b", name: "Stitching", category_name: "Production", created_at: "2026-02-01" },
      { id: "c", name: "Stitching", category_name: "Production", created_at: "2026-03-01" },
    ])

    const names = plan.map((p) => p.after)
    expect(new Set(names).size).toBe(names.length)
  })

  it("is a no-op on an empty catalogue", () => {
    expect(planTemplateNameDeduplication([])).toEqual([])
  })
})
