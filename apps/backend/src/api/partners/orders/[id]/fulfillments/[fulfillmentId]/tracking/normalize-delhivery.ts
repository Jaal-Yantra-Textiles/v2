export type NormalizedTrackingEvent = {
  timestamp: string
  status: string
  location: string
  scan_type: string
}

export type NormalizedTracking = {
  waybill: string
  carrier: "delhivery"
  current_status: string
  current_status_type: string
  estimated_delivery: string | null
  origin: string
  destination: string
  events: NormalizedTrackingEvent[]
}

const STATUS_LABELS: Record<string, string> = {
  UD: "In Transit",
  DL: "Delivered",
  RT: "Returned",
  PP: "Pickup Pending",
  PU: "Picked Up",
  OT: "Out for Delivery",
  NFI: "Not Found",
}

export function normalizeDelhiveryTracking(raw: any): NormalizedTracking {
  const shipment = raw?.ShipmentData?.[0]?.Shipment || {}
  const status = shipment.Status || {}
  const scans = shipment.Scans || []

  const events: NormalizedTrackingEvent[] = scans.map((scan: any) => {
    const detail = scan.ScanDetail || {}
    return {
      timestamp: detail.ScanDateTime || "",
      status: detail.Instructions || detail.Scan || "",
      location: detail.ScannedLocation || "",
      scan_type: detail.StatusCode || detail.ScanType || "",
    }
  })

  // Sort events newest first
  events.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const statusType = status.StatusCode || status.StatusType || ""

  return {
    waybill: shipment.AWB || "",
    carrier: "delhivery",
    current_status: STATUS_LABELS[statusType] || status.Status || "Unknown",
    current_status_type: statusType,
    estimated_delivery: shipment.ExpectedDeliveryDate || null,
    origin: shipment.Origin || "",
    destination: shipment.Destination || "",
    events,
  }
}
