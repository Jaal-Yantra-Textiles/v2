/**
 * What templates did this run go out with LAST time?
 *
 * The redispatch endpoint shipped on the belief that this was unanswerable —
 * "tasks do not carry their template" — so an operator re-sending parked work
 * had to remember, per run, what it was dispatched with, or leave every run
 * stuck at `awaiting_templates`.
 *
 * That belief was wrong. `TaskService.createTaskWithTemplates` stamps
 * `template_id` and `template_name` into every task it instantiates, so the
 * tasks a run already has ARE the record of its last dispatch. Checked against
 * prod (2026-08-12): all 7 parked runs recovered, and they do NOT agree —
 * four distinct template sets across seven runs. A single `template_names`
 * list applied to the batch would have been wrong for most of them.
 *
 * That is the whole point of recovering per run rather than asking once: this
 * mirrors `previous_partner_id`, where each run goes back to its own partner
 * and a batch-wide value would silently mis-route.
 */

/** A task as it comes back from `query.graph({ entity: "task" })`. */
export type RunTask = {
  id?: string
  status?: string | null
  created_at?: string | Date | null
  metadata?: Record<string, any> | null
}

export type RecoveredTemplate = {
  name: string
  /**
   * The template row actually instantiated. Worth more than the name, because
   * names are NOT unique — prod carries two rows called "Stitching"
   * (`01JW0Y60…` and `01K5S31S…`) and the three parked runs that used it used
   * the second. Dispatch resolves by name, so it can pick the other one.
   */
  template_id: string | null
  /**
   * What actually separates two same-named templates. The two "Stitching" rows
   * differ ONLY by category — Pre Production vs Production — which is to say
   * they are different stages of the process wearing the same label. Showing
   * the name alone hides the entire distinction.
   */
  category_name: string | null
}

export type RunTemplateHistory = {
  templates: RecoveredTemplate[]
  /**
   * Where the answer came from, so a caller can tell evidence from intent:
   * - `run_dispatched_ids` — `dispatched_template_ids`, written BY dispatch
   *   itself (#1265). The authoritative record, and ids rather than names, so a
   *   later rename cannot change what it means. Survives task deletion.
   * - `tasks` — templates actually instantiated. What really happened, but
   *   recovered by archaeology, and gone if the tasks are.
   * - `run_dispatch_intent` — `dispatch_template_names`, recorded at APPROVAL.
   *   What someone meant to dispatch, which is not proof it was.
   * - `none` — nothing to go on; a selection must be made by hand.
   */
  source: "run_dispatched_ids" | "tasks" | "run_dispatch_intent" | "none"
  /**
   * Recovered names that match more than one template row. Reported, never
   * resolved — picking one is a judgement about which process the partner
   * should actually follow.
   */
  ambiguous_names: string[]
}

/** One row of the live template catalogue, used to resolve what a task points at. */
export type TemplateCatalogEntry = {
  id: string
  name: string
  category_name?: string | null
}

/**
 * PURE: recover one run's last dispatch from its tasks. Exported for unit tests.
 *
 * Order matters — it is the order the partner works in — so this preserves
 * first-seen order rather than sorting or de-ordering into a set. Duplicates
 * collapse on `template_id` where present and on name otherwise, because the
 * same template instantiated twice is one choice, not two.
 *
 * ⚠️ Cancelled tasks are INCLUDED deliberately. Every task on a parked run is
 * cancelled — that is what parking does — so excluding them would recover
 * nothing for exactly the runs this exists to serve.
 *
 * The catalogue is what turns a bare name into an identified template: the task
 * records which id it was built from, and only the catalogue knows that id sits
 * in "Production" rather than "Pre Production".
 */
export function recoverRunTemplates(
  tasks: RunTask[],
  run?: {
    dispatch_template_names?: string[] | null
    dispatched_template_ids?: string[] | null
  } | null,
  options: { catalog?: TemplateCatalogEntry[] } = {}
): RunTemplateHistory {
  const catalog = options.catalog ?? []
  const byId = new Map(catalog.map((t) => [t.id, t]))
  const nameCounts = new Map<string, number>()
  for (const t of catalog) {
    nameCounts.set(t.name, (nameCounts.get(t.name) ?? 0) + 1)
  }
  const seen = new Set<string>()
  const templates: RecoveredTemplate[] = []

  for (const t of tasks ?? []) {
    const md = t?.metadata ?? {}
    const name = md?.template_name
    if (typeof name !== "string" || !name.length) {
      // The parent `production-run-<id>` task is created directly, not from a
      // template, so it has no stamp. Absence here is structure, not loss.
      continue
    }
    const templateId =
      typeof md?.template_id === "string" && md.template_id.length
        ? md.template_id
        : null
    const key = templateId ?? `name:${name}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    templates.push({
      name,
      template_id: templateId,
      category_name:
        (templateId ? byId.get(templateId)?.category_name : null) ?? null,
    })
  }

  const withAmbiguity = (
    list: RecoveredTemplate[],
    source: RunTemplateHistory["source"]
  ): RunTemplateHistory => ({
    templates: list,
    source,
    // Only meaningful against a catalogue — with none loaded, claiming zero
    // ambiguity would assert something never checked.
    ambiguous_names: catalog.length
      ? [
          ...new Set(
            list.map((t) => t.name).filter((n) => (nameCounts.get(n) ?? 0) > 1)
          ),
        ]
      : [],
  })

  /**
   * The dispatch's own record wins over task archaeology (#1265): it is written
   * by dispatch, it is ids, and it survives the tasks being deleted.
   *
   * An id the catalogue no longer knows is kept rather than dropped — the run
   * really was dispatched with it, and silently shrinking the set would send a
   * shorter process back out than the run actually ran. It stays unnamed, which
   * is the honest reading of a template that no longer exists.
   */
  const dispatchedIds = (run?.dispatched_template_ids ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0
  )
  if (dispatchedIds.length) {
    return withAmbiguity(
      dispatchedIds.map((id) => {
        const hit = byId.get(id)
        return {
          name: hit?.name ?? "",
          template_id: id,
          category_name: hit?.category_name ?? null,
        }
      }),
      "run_dispatched_ids"
    )
  }

  if (templates.length) {
    return withAmbiguity(templates, "tasks")
  }

  // Nothing was ever instantiated — the run was approved with an intent but
  // parked before dispatch created anything. Weaker evidence, labelled as such.
  const intent = (run?.dispatch_template_names ?? []).filter(
    (n): n is string => typeof n === "string" && n.length > 0
  )
  if (intent.length) {
    return withAmbiguity(
      intent.map((name) => {
        // Intent recorded a NAME only. If exactly one template answers to it we
        // can identify it; if two do, it stays unidentified — which is the
        // honest reading, and the ambiguity flag says so.
        const matches = catalog.filter((t) => t.name === name)
        const only = matches.length === 1 ? matches[0] : undefined
        return {
          name,
          template_id: only?.id ?? null,
          category_name: only?.category_name ?? null,
        }
      }),
      "run_dispatch_intent"
    )
  }

  return { templates: [], source: "none", ambiguous_names: [] }
}

export type ResolvedDispatchSelection = {
  template_names: string[]
  /**
   * The recovered template ROWS, when every one of them is identified.
   *
   * #1261: sending the recovered *names* back through dispatch discarded the
   * identification this file exists to produce — the history knew the run used
   * `Stitching (Production)`, and the name-based lookup could then instantiate
   * `Stitching (Pre Production)`. Ids close that gap end-to-end.
   *
   * Empty when any recovered template lacks an id: a half-identified list is
   * not a selection, and falling back to names is honest because dispatch now
   * refuses an ambiguous one outright.
   */
  template_ids: string[]
  source: RunTemplateHistory["source"] | "explicit"
  /** How dispatch will actually resolve this — the thing worth reporting. */
  resolved_by: "id" | "name" | "none"
}

/**
 * PURE: what to actually dispatch each run with. Exported for unit tests.
 *
 * An explicit selection always wins — an operator naming templates has decided,
 * and history must not override a decision. Explicit IDS win over explicit
 * names, for the same reason ids win everywhere else. Recovered history is used
 * ONLY when `use_previous_templates` asked for it, and then per run, never
 * pooled across the batch.
 */
export function resolveDispatchTemplates(
  history: RunTemplateHistory,
  options: {
    explicit?: string[] | null
    explicitIds?: string[] | null
    usePrevious?: boolean
  }
): ResolvedDispatchSelection {
  if (options.explicitIds?.length) {
    return {
      template_names: [],
      template_ids: [...options.explicitIds],
      source: "explicit",
      resolved_by: "id",
    }
  }
  if (options.explicit?.length) {
    return {
      template_names: [...options.explicit],
      template_ids: [],
      source: "explicit",
      resolved_by: "name",
    }
  }
  if (options.usePrevious && history.templates.length) {
    const ids = history.templates.map((t) => t.template_id)
    const fullyIdentified = ids.every(
      (id): id is string => typeof id === "string" && id.length > 0
    )
    return {
      template_names: history.templates.map((t) => t.name),
      template_ids: fullyIdentified ? (ids as string[]) : [],
      source: history.source,
      resolved_by: fullyIdentified ? "id" : "name",
    }
  }
  return {
    template_names: [],
    template_ids: [],
    source: "none",
    resolved_by: "none",
  }
}
