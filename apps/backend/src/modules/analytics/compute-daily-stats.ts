import AnalyticsService from "./service"

export type DailyStatsRow = {
  website_id: string
  date: Date
  pageviews: number
  unique_visitors: number
  sessions: number
  bounce_rate: number
  avg_session_duration: number
  desktop_visitors: number
  mobile_visitors: number
  tablet_visitors: number
  top_pages: Array<{ item: string; count: number }> | null
  top_referrers: Array<{ item: string; count: number }> | null
  top_countries: Array<{ item: string; count: number }> | null
  browser_stats: Array<{ item: string; count: number }> | null
  os_stats: Array<{ item: string; count: number }> | null
  metadata: Record<string, any>
}

function topItems<T>(items: T[], field: keyof T, limit = 10) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const v = item?.[field] as unknown
    if (v === null || v === undefined || v === "") continue
    const key = String(v)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item, count]) => ({ item, count }))
}

function visitorCountByDevice(sessions: Array<{ device_type?: string | null; visitor_id: string }>, type: string) {
  const set = new Set<string>()
  for (const s of sessions) {
    if (s.device_type === type) set.add(s.visitor_id)
  }
  return set.size
}

/**
 * Compute daily stats for a single website on a single day by reading events and sessions.
 * Returns the fully-populated stats row (not yet persisted).
 */
export async function computeDailyStatsForWebsite(
  analyticsService: AnalyticsService,
  websiteId: string,
  day: Date
): Promise<DailyStatsRow | null> {
  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const [events] = await analyticsService.listAndCountAnalyticsEvents(
    {
      website_id: websiteId,
      timestamp: { $gte: dayStart, $lt: dayEnd },
    } as any,
    {
      select: [
        "website_id",
        "event_type",
        "visitor_id",
        "session_id",
        "pathname",
        "referrer_source",
      ],
      take: 100_000,
    } as any
  )

  const [sessions] = await analyticsService.listAndCountAnalyticsSessions(
    {
      website_id: websiteId,
      started_at: { $gte: dayStart, $lt: dayEnd },
    } as any,
    {
      select: [
        "visitor_id",
        "is_bounce",
        "duration_seconds",
        "device_type",
        "browser",
        "os",
        "country",
      ],
      take: 100_000,
    } as any
  )

  if (events.length === 0 && sessions.length === 0) {
    return null
  }

  const pageviews = events.filter((e: any) => e.event_type === "pageview").length
  const uniqueVisitors = new Set(events.map((e: any) => e.visitor_id)).size

  const sessionCount = sessions.length
  const bounceCount = sessions.filter((s: any) => s.is_bounce).length
  const durations = sessions
    .map((s: any) => s.duration_seconds)
    .filter((d: unknown): d is number => typeof d === "number" && Number.isFinite(d))

  return {
    website_id: websiteId,
    date: dayStart,
    pageviews,
    unique_visitors: uniqueVisitors,
    sessions: sessionCount,
    bounce_rate: sessionCount > 0 ? (bounceCount / sessionCount) * 100 : 0,
    avg_session_duration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    desktop_visitors: visitorCountByDevice(sessions as any, "desktop"),
    mobile_visitors: visitorCountByDevice(sessions as any, "mobile"),
    tablet_visitors: visitorCountByDevice(sessions as any, "tablet"),
    top_pages: topItems(events as any, "pathname"),
    top_referrers: topItems((events as any).filter((e: any) => e.referrer_source), "referrer_source"),
    top_countries: topItems(sessions as any, "country"),
    browser_stats: topItems(sessions as any, "browser"),
    os_stats: topItems(sessions as any, "os"),
    metadata: {
      aggregated_at: new Date(),
      total_events: events.length,
      total_sessions: sessionCount,
      total_custom_events: events.filter((e: any) => e.event_type === "custom_event").length,
    },
  }
}

/**
 * Get all distinct website_ids that had activity on a given day (across events + sessions).
 */
export async function listWebsitesWithActivity(
  analyticsService: AnalyticsService,
  day: Date
): Promise<string[]> {
  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const [events] = await analyticsService.listAndCountAnalyticsEvents(
    { timestamp: { $gte: dayStart, $lt: dayEnd } } as any,
    { select: ["website_id"], take: 100_000 } as any
  )
  const [sessions] = await analyticsService.listAndCountAnalyticsSessions(
    { started_at: { $gte: dayStart, $lt: dayEnd } } as any,
    { select: ["website_id"], take: 100_000 } as any
  )

  const ids = new Set<string>()
  for (const e of events as any[]) ids.add(e.website_id)
  for (const s of sessions as any[]) ids.add(s.website_id)
  return Array.from(ids)
}
