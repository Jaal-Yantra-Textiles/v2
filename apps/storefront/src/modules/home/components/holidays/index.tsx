import { getTodayHoliday, countryName } from "@lib/data/holidays"
import HolidayBubbles from "./holiday-bubbles"

export default async function HolidaySection({ countryCode }: { countryCode: string }) {
  const [holiday, name] = await Promise.all([
    getTodayHoliday(countryCode),
    Promise.resolve(countryName(countryCode)),
  ])

  return (
    <HolidayBubbles
      holiday={holiday}
      countryName={name}
      countryCode={countryCode}
    />
  )
}
