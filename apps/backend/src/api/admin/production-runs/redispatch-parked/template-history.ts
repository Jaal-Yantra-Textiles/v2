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
}

export type RunTemplateHistory = {
  templates: RecoveredTemplate[]
  /**
   * Where the answer came from, so a caller can tell evidence from intent:
   * - `tasks` — templates actually instantiated. What really happened.
   * - `run_dispatch_intent` — `dispatch_template_names`, recorded at APPROVAL.
   *   What someone meant to dispatch, which is not proof it was.
   * - `none` — nothing to go on; a selection must be made by hand.
   */
  source: "tasks" | "run_dispatch_intent" | "none"
  /**
   * Recovered names that match more than one template row. Reported, never
   * resolved — picking one is a judgement about which process the partner
   * should actually follow.
   */
  ambiguous_names: string[]
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
 */
export function recoverRunTemplates(
  tasks: RunTask[],
  run?: { dispatch_template_names?: string[] | null } | null,
  options: { templateNameCounts?: Map<string, number> } = {}
): RunTemplateHistory {
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
    templates.push({ name, template_id: templateId })
  }

  const withAmbiguity = (
    list: RecoveredTemplate[],
    source: RunTemplateHistory["source"]
  ): RunTemplateHistory => ({
    templates: list,
    source,
    ambiguous_names: options.templateNameCounts
      ? [
          ...new Set(
            list
              .map((t) => t.name)
              .filter((n) => (options.templateNameCounts!.get(n) ?? 0) > 1)
          ),
        ]
      : [],
  })

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
      intent.map((name) => ({ name, template_id: null })),
      "run_dispatch_intent"
    )
  }

  return { templates: [], source: "none", ambiguous_names: [] }
}

/**
 * PURE: what to actually dispatch each run with. Exported for unit tests.
 *
 * An explicit `template_names` always wins — an operator naming templates has
 * decided, and history must not override a decision. Recovered history is used
 * ONLY when `use_previous_templates` asked for it, and then per run, never
 * pooled across the batch.
 */
export function resolveDispatchTemplates(
  history: RunTemplateHistory,
  options: { explicit?: string[] | null; usePrevious?: boolean }
): { template_names: string[]; source: RunTemplateHistory["source"] | "explicit" } {
  if (options.explicit?.length) {
    return { template_names: [...options.explicit], source: "explicit" }
  }
  if (options.usePrevious && history.templates.length) {
    return {
      template_names: history.templates.map((t) => t.name),
      source: history.source,
    }
  }
  return { template_names: [], source: "none" }
}
