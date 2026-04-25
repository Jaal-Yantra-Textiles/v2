export interface PublicHoliday {
  date: string
  name: string
  localName: string
  countryCode: string
  global: boolean
}

/**
 * Returns today's public holiday for a country, or null if none.
 * Uses Nager.Date — free, no API key required.
 */
export async function getTodayHoliday(countryCode: string): Promise<PublicHoliday | null> {
  const upper = countryCode.toUpperCase()
  const today = new Date()
  const year = today.getFullYear()
  const todayStr = today.toISOString().split("T")[0] // "YYYY-MM-DD"

  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${upper}`,
      { next: { revalidate: 3600 } } // re-check every hour
    )
    if (!res.ok) return null

    const all: PublicHoliday[] = await res.json()
    if (!Array.isArray(all)) return null

    return all.find((h) => h.date === todayStr && h.global !== false) ?? null
  } catch {
    return null
  }
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}
