/**
 * The "how it was made" story printed on a hang tag (#2541).
 *
 * A pure shaper: it takes the design's production story (who is on the roster,
 * which fabrics, who supplied them) plus each partner's place and lead person,
 * and returns structured facts AND a default paragraph. The admin shows the
 * paragraph in a review step, so a person can correct it before printing; the
 * facts are what the paragraph was built from.
 *
 * Rules, because this text is printed and handed to an end customer:
 * - Only facts from records. A partner with no place is named without one; a
 *   fabric with no supplier is not given one. Nothing is guessed.
 * - A partner whose only role is supplier tells the "began in" sentence; every
 *   other roster partner tells a "made" sentence.
 * - Plain sentences, no em dashes (the founder's copy rule).
 */

import type { ProductionStory } from "../../api/store/custom/designs/production-story-lib/build-story"

export type TagPartnerFacts = {
  /** Lead person: the partner's owner admin, else its first admin. */
  lead: string | null
  /** "City, State" from the partner's warehouse address. */
  place: string | null
}

export type TagPartner = {
  id: string
  name: string | null
  lead: string | null
  place: string | null
  /** The stage they do on this design ("stitching", "supplier", …) */
  stage: string | null
}

export type TagFabric = {
  id: string
  name: string | null
  composition: string | null
  color: string | null
  /** From the raw material's specifications, e.g. "HandSpun + HandWoven". */
  technique: string | null
  supplier: TagPartner | null
}

export type TagStory = {
  design_id: string
  makers: TagPartner[]
  fabrics: TagFabric[]
  /** Default paragraph; empty when the records say nothing usable. */
  text: string
}

const SUPPLIER_STAGES = new Set(["supplier", "supply", "material_supplier"])

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim()
  return t.length ? t : null
}

/** "the GOF Asia team" / "Rahul Ghosh and the GOF Asia team" */
function whoPhrase(p: TagPartner): string {
  const name = clean(p.name)
  const team = name ? `the ${name} team` : "the team"
  return p.lead ? `${p.lead} and ${team}` : team
}

/** What a fabric house does, read from the technique; falls back to "make". */
export function craftPhrase(techniques: Array<string | null>): string {
  const t = techniques.filter(Boolean).join(" ").toLowerCase()
  const spun = /spun|spin/.test(t)
  const woven = /woven|weav|loom/.test(t)
  if (spun && woven) return "spin and weave cloth by hand"
  if (woven) return "weave cloth on the handloom"
  if (spun) return "spin yarn by hand"
  return "make the cloth"
}

/** What a maker does with the cloth, read from their stage on the design. */
export function stagePhrase(stage: string | null): string {
  const s = (stage ?? "").toLowerCase()
  if (/stitch|sew|tailor|cut/.test(s)) return "cut and stitched it"
  if (/embroider/.test(s)) return "embroidered it"
  if (/dye/.test(s)) return "dyed it"
  if (/print/.test(s)) return "printed it"
  if (/finish/.test(s)) return "finished it"
  if (/weav/.test(s)) return "wove it"
  return "made it"
}

export function buildTagStory(input: {
  story: ProductionStory
  partnerFacts: Record<string, TagPartnerFacts>
  /** raw material id → technique */
  techniques: Record<string, string | null>
}): TagStory {
  const { story, partnerFacts, techniques } = input

  const toPartner = (id: string, name: string | null, stage: string | null): TagPartner => ({
    id,
    name: clean(name),
    lead: clean(partnerFacts[id]?.lead),
    place: clean(partnerFacts[id]?.place),
    stage: clean(stage),
  })

  const fabrics: TagFabric[] = story.materials.map((m) => ({
    id: m.id,
    name: clean(m.name),
    composition: clean(m.composition),
    color: clean(m.color),
    technique: clean(techniques[m.id]),
    supplier: m.supplier ? toPartner(m.supplier.id, m.supplier.name, "supplier") : null,
  }))

  // One "began in" sentence per supplier, in the order fabrics list them.
  const suppliers = new Map<string, { partner: TagPartner; techniques: Array<string | null> }>()
  for (const f of fabrics) {
    if (!f.supplier) continue
    const entry = suppliers.get(f.supplier.id) ?? { partner: f.supplier, techniques: [] }
    entry.techniques.push(f.technique)
    suppliers.set(f.supplier.id, entry)
  }
  for (const p of story.partners) {
    if (SUPPLIER_STAGES.has((p.stage_role ?? "").toLowerCase()) && !suppliers.has(p.id)) {
      suppliers.set(p.id, { partner: toPartner(p.id, p.name, p.stage_role), techniques: [] })
    }
  }

  const makers: TagPartner[] = story.partners
    .filter((p) => !SUPPLIER_STAGES.has((p.stage_role ?? "").toLowerCase()))
    .map((p) => toPartner(p.id, p.name, p.stage_role))

  const sentences: string[] = []
  for (const { partner, techniques: ts } of suppliers.values()) {
    const craft = craftPhrase(ts)
    sentences.push(
      partner.place
        ? `This began in ${partner.place}, where ${whoPhrase(partner)} ${craft}.`
        : `This began with ${whoPhrase(partner)}, who ${craft}.`
    )
  }

  makers.forEach((m, i) => {
    const verb = stagePhrase(m.stage)
    if (suppliers.has(m.id)) {
      // The fabric house also did this stage: no journey to tell.
      sentences.push(`They also ${verb}.`)
      return
    }
    if (sentences.length === 0 && i === 0) {
      sentences.push(
        m.place
          ? `This was made in ${m.place} by ${whoPhrase(m)}.`
          : `This was made by ${whoPhrase(m)}.`
      )
      return
    }
    const lead = i === 0 ? "The cloth then travelled to" : "Next it went to"
    sentences.push(
      m.place
        ? `${lead} ${m.place}, where ${whoPhrase(m)} ${verb}.`
        : `${i === 0 ? "Then" : "Next,"} ${whoPhrase(m)} ${verb}.`
    )
  })

  return { design_id: story.design_id, makers, fabrics, text: sentences.join(" ") }
}

/** Default care text when a brand profile sets none. */
export const DEFAULT_CARE_TEXT =
  "Handwoven fabric, coloured with vegetable dyes, so each piece is a little different and colours may soften with time. Hand wash gently in cold water, separately, with a mild soap. Do not wring or bleach. Dry in the shade."
