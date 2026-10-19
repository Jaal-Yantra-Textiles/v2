import { mergeJourney, ProductionStory } from "./build-story"

const formatNumber = (value: number) => Number(value.toFixed(2)).toString()

const formatDate = (value: string | null) => {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

/**
 * Template data for the `production-story` email: the FULL story a shopper
 * asked for by leaving their email. Plain strings only, so the template stays
 * a dumb loop. Money-free, like the story itself.
 */
export function buildStoryEmailData(input: {
  story: ProductionStory
  designName?: string | null
  productTitle?: string | null
  productUrl?: string | null
}) {
  const { story } = input
  const c = story.consumption
  const energy = [
    c.energy.electricity_kwh > 0 && `Electricity: ${formatNumber(c.energy.electricity_kwh)} kWh`,
    c.energy.water_liters > 0 && `Water: ${formatNumber(c.energy.water_liters)} L`,
    c.energy.gas_cubic_meters > 0 && `Gas: ${formatNumber(c.energy.gas_cubic_meters)} m³`,
    c.labor_hours > 0 &&
      `Labour: ${formatNumber(c.labor_hours)} ${c.labor_hours === 1 ? "hour" : "hours"}`,
  ].filter((v): v is string => typeof v === "string")

  return {
    title: input.productTitle || input.designName || "your piece",
    product_url: input.productUrl || "",
    steps: mergeJourney(story.runs).map((s) => ({ label: s.label, date: formatDate(s.date) })),
    makers: story.partners.map((p) => p.name).filter(Boolean),
    people: story.people
      .filter((p) => p.name)
      .map((p) => (p.role ? `${p.name} (${p.role})` : p.name)),
    materials: story.materials.map((m) => m.name).filter(Boolean),
    materials_consumed: c.materials_consumed
      .filter((m) => m.quantity > 0)
      .map((m) => `${m.name || "Material"}: ${formatNumber(m.quantity)} ${m.unit_of_measure}`),
    energy,
    current_year: new Date().getFullYear(),
  }
}
