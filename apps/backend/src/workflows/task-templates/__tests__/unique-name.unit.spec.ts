import {
  findDuplicateTemplateNames,
  resolveUniqueTemplateName,
} from "../unique-name"

/**
 * The prod catalogue, trimmed to the rows that matter: "Stitching" exists
 * TWICE and the two differ ONLY by category. That pair is why dispatch could
 * run the wrong process (#1261), and why a new template is now qualified with
 * its category instead of quietly becoming a third ambiguous row.
 */
const CATALOG = [
  { id: "01JW0Y60", name: "Stitching", category_name: "Pre Production" },
  { id: "01K5S31S", name: "Stitching", category_name: "Production" },
  { id: "01JW0Y61", name: "Sampling", category_name: "Pre Production" },
]

describe("resolveUniqueTemplateName", () => {
  it("leaves a free name alone — most templates are the only one of their name", () => {
    const r = resolveUniqueTemplateName("Dyeing", "Production", CATALOG)

    expect(r).toEqual({
      name: "Dyeing",
      qualified: false,
      requested: "Dyeing",
      collided_with: [],
    })
  })

  it("qualifies a taken name with its CATEGORY, which is what distinguishes them", () => {
    const r = resolveUniqueTemplateName("Sampling", "Production", CATALOG)

    // Not "Sampling 2": a counter would be unique while saying nothing about
    // which one to pick, which is the original problem with extra steps.
    expect(r.name).toBe("Sampling (Production)")
    expect(r.qualified).toBe(true)
    expect(r.collided_with.map((t) => t.id)).toEqual(["01JW0Y61"])
  })

  it("falls back to a counter when the qualified form is ALSO taken", () => {
    const r = resolveUniqueTemplateName("Stitching", "Production", [
      ...CATALOG,
      {
        id: "01K5S31T",
        name: "Stitching (Production)",
        category_name: "Production",
      },
    ])

    expect(r.name).toBe("Stitching (Production) 2")
  })

  it("falls back to a counter when there is no category to qualify with", () => {
    const r = resolveUniqueTemplateName("Stitching", null, CATALOG)

    expect(r.name).toBe("Stitching 2")
    expect(r.qualified).toBe(true)
  })

  it("collides case-insensitively — 'stitching' and 'Stitching' read as one name", () => {
    // Dispatch's lookup is exact, but a human reading a list cannot tell these
    // apart, so treating them as distinct would recreate the ambiguity in a
    // form that is harder to see.
    const r = resolveUniqueTemplateName("stitching", "Production", CATALOG)

    expect(r.qualified).toBe(true)
  })

  it("does NOT collide a rename with the row being renamed", () => {
    // Re-saving a template without changing its name must not qualify it.
    const r = resolveUniqueTemplateName(
      "Sampling",
      "Pre Production",
      CATALOG,
      "01JW0Y61"
    )

    expect(r.name).toBe("Sampling")
    expect(r.qualified).toBe(false)
  })

  it("still qualifies a rename onto SOMEONE ELSE'S name", () => {
    const r = resolveUniqueTemplateName(
      "Sampling",
      "Production",
      CATALOG,
      "01K5S31S"
    )

    expect(r.name).toBe("Sampling (Production)")
  })

  it("trims the requested name rather than treating ' Sampling' as free", () => {
    const r = resolveUniqueTemplateName("  Sampling  ", "Production", CATALOG)

    expect(r.requested).toBe("Sampling")
    expect(r.qualified).toBe(true)
  })

  it("returns an empty name untouched and lets the validator reject it", () => {
    // Uniqueness is not the place to enforce required-ness.
    const r = resolveUniqueTemplateName("", "Production", CATALOG)

    expect(r).toEqual({
      name: "",
      qualified: false,
      requested: "",
      collided_with: [],
    })
  })

  it("is safe on an empty catalogue — the first template of a fresh install", () => {
    expect(resolveUniqueTemplateName("Stitching", "Production", []).name).toBe(
      "Stitching"
    )
  })
})

describe("findDuplicateTemplateNames", () => {
  it("reports the name held by more than one template, with both rows", () => {
    const dupes = findDuplicateTemplateNames(CATALOG)

    expect(dupes).toHaveLength(1)
    expect(dupes[0].name).toBe("Stitching")
    expect(dupes[0].templates.map((t) => t.category_name)).toEqual([
      "Pre Production",
      "Production",
    ])
  })

  it("reports nothing when every name identifies one template", () => {
    expect(findDuplicateTemplateNames(CATALOG.slice(1))).toEqual([])
  })
})
