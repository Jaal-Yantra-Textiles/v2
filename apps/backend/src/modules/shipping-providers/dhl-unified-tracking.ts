import type { TrackingResult } from "./provider-interface"

/**
 * DHL **Unified Shipment Tracking** — one API, many carriers.
 *
 * Distinct from `dhl/client.ts`, which drives DHL Express's own MyDHL tracking
 * for shipments WE booked with DHL Express. This one is the developer.dhl.com
 * unified endpoint: it resolves a tracking number across the DHL group,
 * **including Blue Dart** (`service: "bluedart"`), from a single API key.
 *
 * Why Blue Dart tracking routes through here rather than Blue Dart's own
 * tracking endpoint: that endpoint authenticates with a licence key SEPARATE
 * from the shipping licence key, which we do not hold — probed live on
 * 2026-08-13, it returns `{"ShipmentData":{"Error":"License Mismatch"}}`. The
 * unified API returns the same scans for the same AWB using the API-gateway key
 * we already have. One approved key instead of a credential we would have to
 * chase.
 *
 * Verified live 2026-08-13 against AWB 21089967146:
 * `{"shipments":[{"id":"21089967146","service":"bluedart",…}]}`.
 */

export const DHL_UNIFIED_TRACKING_URL = "https://api-eu.dhl.com/track/shipments"

export type DhlUnifiedTrackingConfig = {
  api_key: string
  /** Injected transport for tests. */
  fetchImpl?: typeof fetch
}

export class DhlTrackingError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "DhlTrackingError"
    this.status = status
  }
}

export class DhlUnifiedTrackingClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch

  constructor(cfg: DhlUnifiedTrackingConfig) {
    this.apiKey = cfg.api_key
    this.fetchImpl = cfg.fetchImpl || fetch
  }

  /**
   * Raw tracking payload for one number.
   *
   * `service` narrows the lookup when the number is ambiguous across carriers
   * (e.g. "bluedart", "express", "parcel-de"). Omitting it lets DHL resolve it,
   * which is what we want for an AWB whose carrier we already recorded.
   */
  async track(trackingNumber: string, service?: string): Promise<any> {
    const params = new URLSearchParams({ trackingNumber })
    if (service) params.set("service", service)

    const res = await this.fetchImpl(
      `${DHL_UNIFIED_TRACKING_URL}?${params.toString()}`,
      { method: "GET", headers: { Accept: "application/json", "DHL-API-Key": this.apiKey } }
    )
    const text = await res.text().catch(() => "")
    if (res.status === 404) {
      // A number DHL has never seen. Distinguished from a real failure because
      // "not found yet" is the NORMAL state for the minutes between generating
      // a waybill and the carrier's first scan.
      throw new DhlTrackingError(
        `DHL has no tracking data for ${trackingNumber} yet — a freshly generated waybill takes a while to appear.`,
        404
      )
    }
    if (!res.ok) {
      throw new DhlTrackingError(
        `DHL unified tracking failed (${res.status}): ${text.slice(0, 300)}`,
        res.status
      )
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new DhlTrackingError(
        `DHL unified tracking returned a non-JSON body: ${text.slice(0, 200)}`
      )
    }
  }
}

/** DHL's own coarse status vocabulary, mapped onto ours. */
const STATUS_CODE_MAP: Record<string, string> = {
  "pre-transit": "created",
  transit: "in_transit",
  delivered: "delivered",
  failure: "exception",
  unknown: "in_transit",
}

/**
 * Normalize a unified-tracking payload onto the shape every carrier returns.
 *
 * Pure and exported: this is the half worth testing, and it can be pinned
 * against captured payloads without touching a live account.
 */
export function normalizeDhlUnifiedTracking(
  raw: any,
  fallbackAwb: string,
  carrier: string
): TrackingResult {
  const shipment = Array.isArray(raw?.shipments) ? raw.shipments[0] : raw?.shipments
  const locality = (node: any) =>
    String(node?.location?.address?.addressLocality || node?.address?.addressLocality || "")

  const events = (Array.isArray(shipment?.events) ? shipment.events : []).map(
    (e: any) => ({
      timestamp: String(e?.timestamp || ""),
      // `description` is the human scan text ("PICKUP HAS BEEN REGISTERED");
      // `status` is a two-letter carrier code ("PU") that means nothing to an
      // operator reading a timeline.
      status: String(e?.description || e?.status || e?.statusCode || "").trim(),
      location: locality(e),
      scan_type: classifyDhlStatus(e?.statusCode, e?.description),
    })
  )

  return {
    carrier,
    awb: String(shipment?.id || fallbackAwb),
    current_status: String(
      shipment?.status?.description || shipment?.status?.statusCode || ""
    ).trim(),
    current_status_code: shipment?.status?.statusCode || undefined,
    estimated_delivery: shipment?.estimatedTimeOfDelivery || null,
    origin: locality({ location: shipment?.origin }) || undefined,
    destination: locality({ location: shipment?.destination }) || undefined,
    events,
    raw,
  }
}

/**
 * Classify one scan.
 *
 * The description is consulted BEFORE the coarse code, because DHL's
 * `statusCode` collapses several outcomes we must keep apart: an RTO and a
 * normal leg both report `transit`, and treating a return as ordinary transit
 * is how a parcel coming back to us looks like a parcel still going out.
 *
 * An unrecognised scan maps to `in_transit`, never `delivered` — same rule as
 * the Delhivery normalizer (#1206). Guessing delivery closes an order whose
 * parcel is still moving, and nobody notices until the customer complains.
 */
export function classifyDhlStatus(
  statusCode?: string,
  description?: string
): string {
  const d = String(description || "").toLowerCase()
  if (/\brto\b|return to origin|returned to shipper/.test(d)) return "returned"
  if (/out for delivery/.test(d)) return "out_for_delivery"
  if (/undeliver|delivery attempt failed|refused/.test(d)) return "exception"
  if (/cancel/.test(d)) return "cancelled"
  if (/picked up|pickup has been|shipment collected/.test(d)) return "picked_up"
  if (/delivered/.test(d) && !/undelivered/.test(d)) return "delivered"

  return STATUS_CODE_MAP[String(statusCode || "").toLowerCase()] || "in_transit"
}
