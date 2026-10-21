import type { PartnerProfile } from "@lib/data/partner-profile"

/** "3 weavers", "1 dyer" — role names from admin are often capitalised. */
export function roleLine(role: string, count: number): string {
  const word = role.trim().toLowerCase()
  if (count === 1) return `1 ${word}`
  const plural = /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`
  return `${count} ${plural}`
}

/** "Weaves · Dyes" from the capability action vocabulary. */
const ACTION_WORDS: Record<string, string> = {
  spin: "Spinning",
  weave: "Weaving",
  dye: "Dyeing",
  print: "Printing",
  embroider: "Embroidery",
  stitch: "Stitching",
  knit: "Knitting",
  cut: "Cutting",
  finish: "Finishing",
}

export function craftsOf(profile: Pick<PartnerProfile, "capabilities">): string[] {
  const seen: string[] = []
  for (const c of profile.capabilities) {
    for (const a of c.actions) {
      const word = ACTION_WORDS[a] ?? a.charAt(0).toUpperCase() + a.slice(1)
      if (!seen.includes(word)) seen.push(word)
    }
    const technique = c.technique?.trim()
    if (technique && !seen.some((s) => s.toLowerCase() === technique.toLowerCase())) {
      seen.push(technique)
    }
  }
  return seen
}

/** "Since June 2026". */
export function sinceLine(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return `Making with us since ${d.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 })

/**
 * Plain lines, only for what was measured. A zero is left out: "0 litres of
 * water" reads as a claim that none was used.
 */
export function energyLines(energy: PartnerProfile["energy"]): string[] {
  if (!energy) return []
  const out: string[] = []
  if (energy.electricity_kwh > 0) out.push(`${fmt(energy.electricity_kwh)} kWh of electricity`)
  if (energy.water_liters > 0) out.push(`${fmt(energy.water_liters)} litres of water`)
  if (energy.gas_cubic_meters > 0) out.push(`${fmt(energy.gas_cubic_meters)} m³ of gas`)
  return out
}

export function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? null
  } catch {
    return null
  }
}
