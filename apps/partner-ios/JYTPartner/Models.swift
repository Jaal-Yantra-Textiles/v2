import Foundation

// The partner API contract for design orders, mirrored from the backend
// (`GET /partners/orders?kind=design` — apps/backend/src/api/partners/orders/
// + workflows/orders/list-partner-orders.ts) and the partner-ui types
// (`apps/partner-ui/src/lib/work-status.ts`, `.../design-cell.tsx`).

/// One design of a work-order, as summarised by the partner orders list.
struct OrderDesignSummary: Codable, Identifiable, Hashable {
  let id: String
  var name: String?
  var thumbnail: String?
}

/// §5 work-progress vocabulary, unified on the `unified_order_status`
/// sidecar column. Same labels as the web UI.
enum WorkStatus: String, Codable {
  case assigned
  case accepted
  case inProgress = "in_progress"
  case partial
  case finished
  case completed
  case declined
  case cancelled

  var label: String {
    switch self {
    case .assigned: return "Assigned"
    case .accepted: return "Accepted"
    case .inProgress: return "In Progress"
    case .partial: return "Partial"
    case .finished: return "Finished"
    case .completed: return "Completed"
    case .declined: return "Declined"
    case .cancelled: return "Cancelled"
    }
  }
}

/// A row of the partner orders list (design kind). The LIST route enriches
/// rows with `designs` + `currency_code`; the DETAIL read (Medusa's admin
/// order shape) carries neither — it instead attaches `production_runs`
/// refs. Both decode into this one model; every field the two shapes
/// disagree on is optional.
struct PartnerOrder: Codable, Identifiable, Hashable {
  let id: String
  let display_id: Int
  var status: String
  var payment_status: String?
  var fulfillment_status: String?
  var email: String?
  var total: Double
  /// Present on LIST rows, absent on the detail read.
  var currency_code: String?
  var created_at: Date
  /// Design summary attached server-side to design-kind LIST rows.
  var designs: [OrderDesignSummary]?
  /// Line items (present on the order detail read).
  var items: [PartnerOrderItem]?
  /// Run refs attached by the detail read (`[{id}]`) — the matching
  /// production runs, fetched one by one for the runs section.
  var production_runs: [ProductionRunRef]?
  /// Work status (assigned → … → completed) off the sidecar column.
  var unified_order_status: UnifiedOrderStatus?

  var workStatus: WorkStatus? {
    unified_order_status?.partner_status.flatMap(WorkStatus.init(rawValue:))
  }
}

struct ProductionRunRef: Codable, Identifiable, Hashable {
  let id: String
}

struct UnifiedOrderStatus: Codable, Hashable {
  var partner_status: String?
}

struct PartnerOrderItem: Codable, Hashable, Identifiable {
  let id: String
  var title: String?
  var subtitle: String?
  var thumbnail: String?
  var quantity: Int
  var total: Double
}

struct PartnerOrderListResponse: Codable {
  let orders: [PartnerOrder]
  let count: Int
  let offset: Int
  let limit: Int
}

/// `GET /partners/me` — `{admin, partner_id}` per the backend route
/// (apps/backend/src/api/partners/me/route.ts). The admin is the signed-in
/// user; the partner record itself is addressed by id.
struct PartnerMe: Codable {
  struct Admin: Codable {
    let id: String
    var email: String
    var first_name: String?
    var last_name: String?
    var role: String?
  }
  var admin: Admin?
  var partner_id: String?

  /// "E2E Partner" from first/last name, falling back to the email.
  var displayName: String {
    let first = admin?.first_name ?? ""
    let last = admin?.last_name ?? ""
    let joined = "\(first) \(last)"
      .trimmingCharacters(in: .whitespaces)
    return joined.isEmpty ? (admin?.email ?? "Partner") : joined
  }
}

enum PartnerError: LocalizedError {
  case invalidResponse
  case decoding(String)
  case http(status: Int, message: String)

  var errorDescription: String? {
    switch self {
    case .invalidResponse:
      return "The server sent an unexpected response."
    case .decoding(let detail):
      return "The server sent an unexpected response (\(detail))."
    case .http(let status, let message):
      if status == 401 {
        return "Invalid email or password."
      }
      return message.isEmpty ? "Request failed (HTTP \(status))." : message
    }
  }
}

/// Currency formatting in the order's own currency — Medusa v2 stores
/// prices in major units, so the raw value formats directly.
extension NumberFormatter {
  func string(_ amount: Double, code: String) -> String {
    currencyCode = code.uppercased()
    return string(from: NSNumber(value: amount)) ?? "N/A"
  }
}
