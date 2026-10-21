/**
 * The public page of a partner (#2444): pure shaping, no I/O.
 *
 * Everything here is read by strangers, so each helper answers "what may we
 * say" as well as "what is true":
 *   · people are counted by role, never named — nobody has agreed to be shown;
 *   · energy comes only from logs someone actually entered — the #697 backfill
 *     wrote a flat 30 kWh per finished run, which is an assumption, not a
 *     measurement;
 *   · a run counts once it has a completion date — runs minted "completed"
 *     from a stock fulfilment never have one, and the partner made nothing.
 */

export type ProfileRun = {
  id: string
  partner_id?: string | null
  parent_run_id?: string | null
  status?: string | null
  run_type?: string | null
  quantity?: number | null
  produced_quantity?: number | null
  completed_at?: string | Date | null
  design_id?: string | null
}

export type ProfileLog = {
  production_run_id?: string | null
  consumption_type?: string | null
  quantity?: number | null
  quantity_basis?: "total" | "per_piece" | null
  metadata?: Record<string, any> | null
}

export type RunSummary = {
  pieces_made: number
  samples_made: number
  pieces_last_90_days: number
  making_since: string | null
  /** completed runs that counted, for the energy roll-up */
  run_ids: string[]
  design_ids: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

const iso = (v: string | Date | null | undefined): string | null => {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Pieces this partner finished. A run assigned onward to the same partner has
 * a child carrying the same work; only the leaf counts, or the work is counted
 * twice.
 */
export function summarizeRuns(
  runs: ProfileRun[],
  partnerId: string,
  now: Date = new Date()
): RunSummary {
  const mine = runs.filter((r) => r.partner_id === partnerId)
  const parents = new Set(mine.map((r) => r.parent_run_id).filter(Boolean))
  const done = mine.filter(
    (r) => r.status === "completed" && iso(r.completed_at) && !parents.has(r.id)
  )

  const since = now.getTime() - 90 * DAY_MS
  const out: RunSummary = {
    pieces_made: 0,
    samples_made: 0,
    pieces_last_90_days: 0,
    making_since: null,
    run_ids: [],
    design_ids: [],
  }
  for (const r of done) {
    const qty = Math.max(0, Number(r.produced_quantity ?? r.quantity ?? 0) || 0)
    const at = iso(r.completed_at)!
    if (r.run_type === "sample") {
      out.samples_made += qty
    } else {
      out.pieces_made += qty
      if (new Date(at).getTime() >= since) out.pieces_last_90_days += qty
    }
    if (!out.making_since || at < out.making_since) out.making_since = at
    out.run_ids.push(r.id)
    if (r.design_id && !out.design_ids.includes(r.design_id)) {
      out.design_ids.push(r.design_id)
    }
  }
  return out
}

/** Logs a maintenance job synthesised (#697) rather than someone recording. */
export const isEstimatedLog = (log: ProfileLog): boolean =>
  String(log?.metadata?.source ?? "").startsWith("ops_maintenance")

export type EnergySummary = {
  electricity_kwh: number
  water_liters: number
  gas_cubic_meters: number
}

const ENERGY_KEYS: Record<string, keyof EnergySummary> = {
  energy_electricity: "electricity_kwh",
  energy_water: "water_liters",
  energy_gas: "gas_cubic_meters",
}

/**
 * Measured energy across the given runs, or null when nothing was measured —
 * the page then says nothing rather than "0 kWh", which would read as a claim.
 * A per-piece log is scaled by the pieces that run produced.
 */
export function summarizeEnergy(
  logs: ProfileLog[],
  runs: ProfileRun[]
): EnergySummary | null {
  const pieces = new Map(
    runs.map((r) => [r.id, Number(r.produced_quantity ?? r.quantity ?? 0) || 0])
  )
  const out: EnergySummary = { electricity_kwh: 0, water_liters: 0, gas_cubic_meters: 0 }
  let any = false
  for (const log of logs) {
    const key = ENERGY_KEYS[String(log?.consumption_type)]
    if (!key || isEstimatedLog(log)) continue
    if (!log.production_run_id || !pieces.has(log.production_run_id)) continue
    const qty = Number(log.quantity) || 0
    if (qty <= 0) continue
    const scaled =
      log.quantity_basis === "per_piece" ? qty * (pieces.get(log.production_run_id) || 0) : qty
    out[key] += scaled
    any = true
  }
  if (!any) return null
  const round1 = (n: number) => Math.round(n * 10) / 10
  return {
    electricity_kwh: round1(out.electricity_kwh),
    water_liters: round1(out.water_liters),
    gas_cubic_meters: round1(out.gas_cubic_meters),
  }
}

export type ProfilePerson = {
  id: string
  person_types?: Array<{ name?: string | null } | null> | null
}

/** "3 Weavers, 1 Dyer" — counts only. A person with no role is not counted. */
export function countRoles(people: ProfilePerson[]): Array<{ role: string; count: number }> {
  const counts = new Map<string, number>()
  for (const p of people ?? []) {
    const roles = new Set(
      (p?.person_types ?? [])
        .map((t) => String(t?.name ?? "").trim())
        .filter(Boolean)
    )
    for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1)
  }
  return Array.from(counts, ([role, count]) => ({ role, count })).sort(
    (a, b) => b.count - a.count || a.role.localeCompare(b.role)
  )
}

export type ProfileSample = {
  id: string
  title?: string | null
  technique?: string | null
  material?: string | null
  product_type?: string | null
  actions?: string[] | null
  media_file_ids?: string[] | null
  captured_at?: string | Date | null
}

export type ProfileMedia = {
  id: string
  file_path?: string | null
  file_type?: string | null
  is_public?: boolean | null
  alt_text?: string | null
}

export type PublicCapability = {
  id: string
  title: string
  technique: string | null
  material: string | null
  product_type: string | null
  actions: string[]
  images: Array<{ url: string; alt: string }>
}

/**
 * What they make, with photographs. A media file marked private, or one that
 * is not an image, is left out; a sample with no title is left out — there is
 * nothing to say about it.
 */
export function publicCapabilities(
  samples: ProfileSample[],
  media: ProfileMedia[]
): PublicCapability[] {
  const byId = new Map(media.map((m) => [m.id, m]))
  return (samples ?? [])
    .filter((s) => String(s?.title ?? "").trim())
    .map((s) => {
      const title = String(s.title).trim()
      const images = (s.media_file_ids ?? [])
        .map((id) => byId.get(id))
        .filter(
          (m): m is ProfileMedia =>
            !!m?.file_path && m.is_public !== false && m.file_type === "image"
        )
        .map((m) => ({ url: m.file_path!, alt: m.alt_text?.trim() || title }))
      return {
        id: s.id,
        title,
        technique: s.technique ?? null,
        material: s.material ?? null,
        product_type: s.product_type ?? null,
        actions: Array.isArray(s.actions) ? s.actions : [],
        images,
      }
    })
}
