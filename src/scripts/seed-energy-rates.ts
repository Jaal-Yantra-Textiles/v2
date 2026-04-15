import { ENERGY_RATES_MODULE } from "../modules/energy_rates"

/**
 * Default energy rates for textile production in India.
 *
 * These are baseline estimates — admins should update rates via
 * Settings > Energy Rates to match their actual regional costs.
 *
 * Sources:
 * - Electricity: MSEDCL industrial tariff (Maharashtra, 2024-25)
 * - Water: Municipal industrial water rates (avg. Indian metros)
 * - Gas: PNG industrial rate (Mahanagar Gas, Mumbai)
 * - Labor: Textile industry average (skilled artisan, India)
 */
const energyRatesData = [
  // ── Electricity ───────────────────────────────────────────────────────
  {
    name: "Industrial Electricity - Standard",
    energy_type: "energy_electricity",
    unit_of_measure: "kWh",
    rate_per_unit: 9.5,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: true,
    notes: "Average industrial electricity rate across Indian states. Update per your state tariff.",
  },
  {
    name: "Industrial Electricity - Maharashtra",
    energy_type: "energy_electricity",
    unit_of_measure: "kWh",
    rate_per_unit: 10.08,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "Maharashtra",
    is_active: true,
    notes: "MSEDCL HT-I industrial tariff including fuel surcharge and duty.",
  },
  {
    name: "Industrial Electricity - Tamil Nadu",
    energy_type: "energy_electricity",
    unit_of_measure: "kWh",
    rate_per_unit: 7.35,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "Tamil Nadu",
    is_active: false,
    notes: "TANGEDCO textile-specific concessional rate. Activate if operating in TN.",
  },
  {
    name: "Industrial Electricity - Gujarat",
    energy_type: "energy_electricity",
    unit_of_measure: "kWh",
    rate_per_unit: 8.2,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "Gujarat",
    is_active: false,
    notes: "GUVNL industrial rate. Activate if operating in Gujarat.",
  },

  // ── Water ─────────────────────────────────────────────────────────────
  {
    name: "Industrial Water - Standard",
    energy_type: "energy_water",
    unit_of_measure: "Liter",
    rate_per_unit: 0.06,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: true,
    notes: "Municipal industrial water rate (Rs 60/kL). Dyeing/washing heavy — track carefully.",
  },
  {
    name: "Industrial Water - Tanker (Drought/Shortage)",
    energy_type: "energy_water",
    unit_of_measure: "Liter",
    rate_per_unit: 0.25,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: false,
    notes: "Private tanker water rate during shortage periods. Activate when municipal supply is disrupted.",
  },

  // ── Gas ───────────────────────────────────────────────────────────────
  {
    name: "PNG Industrial - Standard",
    energy_type: "energy_gas",
    unit_of_measure: "Cubic_Meter",
    rate_per_unit: 38.0,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: true,
    notes: "Piped natural gas industrial rate. Used for boilers, steam generation in dyeing/finishing.",
  },

  // ── Labor ─────────────────────────────────────────────────────────────
  {
    name: "Skilled Artisan - Weaving",
    energy_type: "labor",
    unit_of_measure: "Hour",
    rate_per_unit: 250,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: true,
    notes: "Skilled handloom/powerloom weaver. Includes wages + overhead (PF, ESI, etc.).",
  },
  {
    name: "Skilled Artisan - Dyeing/Finishing",
    energy_type: "labor",
    unit_of_measure: "Hour",
    rate_per_unit: 220,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: false,
    notes: "Dyeing and finishing specialist. Activate and adjust based on your partner rates.",
  },
  {
    name: "Semi-Skilled Worker - General",
    energy_type: "labor",
    unit_of_measure: "Hour",
    rate_per_unit: 150,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: false,
    notes: "Helper/assistant level. Cutting, packaging, material handling.",
  },
  {
    name: "Skilled Artisan - Embroidery/Hand Work",
    energy_type: "labor",
    unit_of_measure: "Hour",
    rate_per_unit: 300,
    currency: "inr",
    effective_from: new Date("2025-04-01"),
    effective_to: null,
    region: "India - General",
    is_active: false,
    notes: "Specialized hand embroidery (zari, chikankari, etc.). Premium skilled work.",
  },
]

export default async function seedEnergyRates({ container }: { container: any }) {
  const energyRateService = container.resolve(ENERGY_RATES_MODULE)

  console.log("Seeding energy rates...")

  for (const rateData of energyRatesData) {
    // Check if a rate with the same name already exists
    let existing: any = null
    try {
      const [rates] = await energyRateService.listAndCountEnergyRates(
        { name: rateData.name },
        { take: 1 }
      )
      existing = rates?.[0]
    } catch {
      // Module may not support name filter — try energy_type + region
      try {
        const [rates] = await energyRateService.listAndCountEnergyRates(
          { energy_type: rateData.energy_type, region: rateData.region },
          { take: 10 }
        )
        existing = rates?.find((r: any) => r.name === rateData.name)
      } catch {}
    }

    if (existing) {
      console.log(`  Rate '${rateData.name}' already exists — skipping`)
      continue
    }

    try {
      await energyRateService.createEnergyRates(rateData)
      console.log(`  Created: ${rateData.name} (${rateData.rate_per_unit} ${rateData.currency.toUpperCase()}/${rateData.unit_of_measure})${rateData.is_active ? "" : " [inactive]"}`)
    } catch (error: any) {
      console.error(`  Failed to create '${rateData.name}':`, error.message)
    }
  }

  console.log("Energy rates seeding completed!")
  console.log("")
  console.log("Active rates seeded:")
  console.log("  - Electricity: 9.50 INR/kWh (India General)")
  console.log("  - Electricity: 10.08 INR/kWh (Maharashtra)")
  console.log("  - Water: 0.06 INR/Liter (India General)")
  console.log("  - Gas: 38.00 INR/m³ (India General)")
  console.log("  - Labor (Weaving): 250 INR/Hour")
  console.log("")
  console.log("Inactive rates also seeded for Tamil Nadu, Gujarat, tanker water,")
  console.log("dyeing labor, semi-skilled, and embroidery — activate as needed")
  console.log("in Settings > Energy Rates.")
}
