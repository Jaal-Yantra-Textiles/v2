import Foundation

// The inventory-order API contract, mirrored from the backend
// (`apps/backend/src/api/partners/inventory-orders/`) and the partner-ui
// hooks (`apps/partner-ui/src/hooks/api/partner-inventory-orders.tsx`).
//
// The partner is the SUPPLIER here: they are commissioned to make/ship raw
// material (cloth, yarn, trim) and "complete" = record what was delivered,
// per line, with a delivery date and tracking number — the goods receipt
// the backend then receives against stock.

/// Lifecycle of an inventory order — the backend enum verbatim
/// (apps/backend/src/modules/inventory_orders/models/order.ts).
enum InventoryOrderStatus: String, Codable, CaseIterable {
  case pending = "Pending"
  case processing = "Processing"
  case readyForDelivery = "Ready for Delivery"
  case shipped = "Shipped"
  case delivered = "Delivered"
  case cancelled = "Cancelled"
  case partial = "Partial"

  var tint: String {
    switch self {
    case .pending: return "indigo"
    case .processing: return "orange"
    case .readyForDelivery: return "teal"
    case .shipped: return "blue"
    case .delivered: return "green"
    case .cancelled: return "gray"
    case .partial: return "orange"
    }
  }
}

/// One order line — these goods are cloth, yarn and trim, so quantity is a
/// REAL (metres/kilograms), not a count. `fulfilled` sums the line's
/// fulfillment records so the receipt can prefill what's already sent.
struct InventoryOrderLine: Codable, Identifiable, Hashable {
  let id: String
  var inventory_item_id: String?
  var quantity: Double
  var price: Double
  var extra_cost: Double?
  var metadata: [String: String]?
  var inventory_items: [InventoryItemSummary]?
  var line_fulfillments: [LineFulfillment]?

  /// The material's display name — raw-material name, else SKU, else line id.
  var displayName: String {
    inventory_items?.first?.raw_materials?.first?.name
      ?? inventory_items?.first?.sku
      ?? "Material"
  }

  var fulfilled: Double {
    line_fulfillments?.reduce(0) { $0 + ($1.quantity ?? 0) } ?? 0
  }

  var outstanding: Double { max(quantity - fulfilled, 0) }
}

struct InventoryItemSummary: Codable, Hashable {
  var id: String?
  var sku: String?
  var title: String?
  var raw_materials: [RawMaterialSummary]?
}

struct RawMaterialSummary: Codable, Hashable {
  var id: String?
  var name: String?
}

struct LineFulfillment: Codable, Hashable {
  var id: String?
  var quantity: Double?
  var status: String?
}

/// The partner-side workflow state the commissioning flow tracks
/// (`partner_info` on the detail read).
struct InventoryOrderPartnerInfo: Codable, Hashable {
  var assigned_partner_id: String?
  var partner_name: String?
  var partner_status: String?
  var partner_started_at: Date?
  var partner_completed_at: Date?
  var delivery_date: Date?
  var tracking_number: String?
  var admin_notes: String?
  var workflow_tasks_count: Int?
}

/// An inventory order — the raw-material purchase the partner is
/// commissioned for. List and detail differ in which fields are populated;
/// everything the two disagree on is optional.
struct PartnerInventoryOrder: Codable, Identifiable, Hashable {
  let id: String
  var status: String
  var quantity: Double?
  var total_price: Double?
  var currency_code: String?
  var expected_delivery_date: Date?
  var order_date: Date?
  var is_sample: Bool?
  var order_lines: [InventoryOrderLine]?
  var partner_info: InventoryOrderPartnerInfo?
  var created_at: Date?
  var updated_at: Date?

  var statusEnum: InventoryOrderStatus? {
    InventoryOrderStatus(rawValue: status)
  }

  /// What the partner still owes on this order, summed over lines.
  var outstandingQuantity: Double {
    order_lines?.reduce(0) { $0 + $1.outstanding } ?? 0
  }
}

struct PartnerInventoryOrderListResponse: Codable {
  let inventory_orders: [PartnerInventoryOrder]
  let count: Int
  let limit: Int
  let offset: Int
}

/// `GET /partners/inventory-orders/:id/charges` — the applied charges and
/// what they make the order payable to (#1737). Folded server-side; the
/// direction of each row is the backend's, never re-derived here.
struct InventoryOrderChargesResponse: Codable {
  struct Charge: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let amount: Double
    var note: String?
    var direction: Int?
  }

  struct Totals: Codable, Hashable {
    var raises: Double?
    var lowers: Double?
    var net: Double?
  }

  var charges: [Charge]
  var totals: Totals?
  var goods_total: Double?
  var payable_ceiling: Double?
}

/// The complete (goods-receipt) payload —
/// `POST /partners/inventory-orders/:id/complete`.
struct CompleteInventoryOrderBody: Codable {
  struct Line: Codable {
    let order_line_id: String
    let quantity: Double
  }

  var notes: String?
  /// "YYYY-MM-DD" — the backend validator takes the date as a string.
  var deliveryDate: String?
  var trackingNumber: String?
  var lines: [Line]
}
