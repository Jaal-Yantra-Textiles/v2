/**
 * Template names, kept unique — because the rest of the platform treats a name
 * as if it were an identity.
 *
 * #1261: prod carries two templates called "Stitching", differing ONLY by
 * category (Pre Production vs Production). Dispatch resolved by name, so it
 * could instantiate the wrong process, and nothing said so afterwards — the
 * task is titled `Stitching` either way. Dispatch now refuses an ambiguous name
 * outright, which makes the collision loud instead of silent.
 *
 * This closes the other half: stop MAKING collisions. A second template created
 * under an existing name is qualified with its category, so `Stitching` in
 * Pre Production becomes `Stitching (Pre Production)` and is nameable again.
 *
 * The category is the qualifier because the category IS what distinguishes the
 * two rows — they are different stages of the process wearing one label. A
 * numeric suffix would make the name unique while saying nothing about which
 * one to pick, which is the current problem with extra steps.
 *
 * ⚠️ Existing rows are NOT touched from here. Renaming a live template changes
 * what every stored `dispatch_template_names` intent resolves to, so the prod
 * backfill is a maintenance job with a dry-run, not a side effect of this file.
 */

/** A name already in use, and the category that holds it. */
export type ExistingTemplateName = {
  id: string
  name: string
  category_name?: string | null
}

export type UniqueNameResult = {
  name: string
  /** True when the requested name was taken and had to be qualified. */
  qualified: boolean
  /** The name the caller asked for, kept so the change can be reported. */
  requested: string
  /**
   * Which templates already held the requested name. Empty when nothing
   * collided — a caller reporting the rename should say what it collided with.
   */
  collided_with: ExistingTemplateName[]
}

const norm = (n: string) => n.trim().toLowerCase()

/**
 * PURE. Decide the name a newly created (or renamed) template should carry.
 *
 * Free name → returned unchanged. Nothing is qualified pre-emptively: most
 * templates are the only one of their name, and `Sampling (Pre Production)`
 * everywhere would be noise that hides the collisions that matter.
 *
 * @param requested  the name the operator typed
 * @param categoryName  the category the template is being filed under
 * @param existing  every current template name; pass the whole catalogue
 * @param excludeId  the row being renamed, so it does not collide with itself
 */
export function resolveUniqueTemplateName(
  requested: string,
  categoryName: string | null | undefined,
  existing: ExistingTemplateName[],
  excludeId?: string | null
): UniqueNameResult {
  const name = (requested ?? "").trim()
  const others = (existing ?? []).filter(
    (t) => t && t.name && (!excludeId || t.id !== excludeId)
  )
  const taken = new Set(others.map((t) => norm(String(t.name))))

  const collided = others.filter((t) => norm(String(t.name)) === norm(name))

  if (!name.length || !collided.length) {
    return { name, qualified: false, requested: name, collided_with: [] }
  }

  const category = (categoryName ?? "").trim()

  // Qualified by category where there is one. `Stitching (Pre Production)`
  // reads as the same step in a named stage, which is what it is.
  const candidates: string[] = category.length
    ? [`${name} (${category})`]
    : []

  // No category, or the qualified form is ALSO taken (a third "Stitching" in
  // Pre Production). A counter is a poor name, but a collision is worse:
  // uniqueness is the property everything downstream depends on.
  const base = candidates[0] ?? name
  for (let i = 2; i <= 50; i++) {
    candidates.push(`${base} ${i}`)
  }

  const chosen = candidates.find((c) => !taken.has(norm(c)))

  return {
    // Falling back to the requested name would hand back a duplicate while
    // claiming success. Better to return something unique and ugly.
    name: chosen ?? `${base} ${Date.now()}`,
    qualified: true,
    requested: name,
    collided_with: collided,
  }
}

/**
 * PURE. Group a catalogue by name to find every name held by more than one
 * template. What the prod backfill reports on, and what dispatch refuses.
 */
export function findDuplicateTemplateNames(
  existing: ExistingTemplateName[]
): { name: string; templates: ExistingTemplateName[] }[] {
  const byName = new Map<string, ExistingTemplateName[]>()
  for (const t of existing ?? []) {
    if (!t?.name) {
      continue
    }
    const key = norm(String(t.name))
    byName.set(key, [...(byName.get(key) ?? []), t])
  }

  return [...byName.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => ({ name: String(rows[0].name), templates: rows }))
}
