import { sdk } from "./config";

/**
 * Every CRM list route hard-clamps `limit` to 100:
 *
 *   const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100)
 *
 * It does not error on a larger ask — it silently serves 100. Both CRM screens
 * asked for `limit: 500` and believed they had every row, which with 234
 * contacts in production meant:
 *
 *  - the "Open a deal" contact dropdown listed the first 100 contacts, so 134
 *    people simply could not be picked; and
 *  - arriving from a contact BEYOND that 100 prefilled an id with no matching
 *    option, so the field rendered its "Nobody yet" placeholder — the deal was
 *    being opened against a contact the form could not show; and
 *  - the pipeline board resolved `owner_person_id` through the same truncated
 *    list, so a deal that DID carry a contact rendered with no contact line at
 *    all (the card only renders that line when a name resolves).
 *
 * So: page, and use the `count` the route already returns. A caller that wants
 * "all of them" must say so in a way the server cannot quietly reinterpret.
 */
export const CRM_LIST_PAGE_SIZE = 100;

/** Refuses to spin forever; 50 pages = 5,000 rows. */
const MAX_PAGES = 50;

export type CrmListResult<T> = {
  rows: T[];
  /** The server's total. */
  count: number;
  /**
   * True when we stopped at MAX_PAGES with rows still unread. A screen that
   * filters client-side is then filtering over a subset, and must say so rather
   * than present a short list as the whole truth.
   */
  truncated: boolean;
};

/**
 * Read an entire CRM collection, one 100-row page at a time.
 *
 * `key` is the response envelope key (`crm_people`, `crm_companies`) — a wrong
 * one reads as an empty collection with no error at all.
 */
export async function fetchAllCrm<T extends { id: string }>(
  path: string,
  key: string
): Promise<CrmListResult<T>> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let count = 0;
  let page = 0;

  for (; page < MAX_PAGES; page++) {
    const res = await sdk.client.fetch<Record<string, unknown>>(path, {
      query: { limit: CRM_LIST_PAGE_SIZE, offset: rows.length },
    });

    const batch = (res?.[key] as T[] | undefined) ?? [];
    count = typeof res?.count === "number" ? (res.count as number) : rows.length;

    // A page that adds nothing new ends the walk. This is the guard against a
    // backend that ignores `offset` and re-serves page one: without it we would
    // loop MAX_PAGES times and hand back 5,000 duplicates of the same 100 rows.
    let added = 0;
    for (const row of batch) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      added++;
    }
    if (added === 0) break;
    if (rows.length >= count) break;
  }

  return { rows, count, truncated: page >= MAX_PAGES && rows.length < count };
}
