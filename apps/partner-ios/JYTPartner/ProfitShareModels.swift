import Foundation

// MARK: - Profit share (#2322 / #2401)
//
// GET /partners/production-runs/:id/profit-share and the
// POST .../profit-share/sales response. A run made with our material can
// carry a deal: the partner owes us `percent` of what they sell its pieces
// for. `percent == nil` (and so `summary.owed == nil`) means there is NO
// deal — never read that as "₹0 owed".
//
// Money columns are bigNumbers that may arrive as a JSON string ("450") or a
// number, so every amount decodes through FlexibleDouble.

struct ProfitShare: Codable {
  let production_run_id: String
  var partner_id: String?
  var percent: FlexibleDouble?
  var sales: [ProfitShareSale]
  var settlements: [ProfitShareSettlement]
  var summary: ProfitShareSummary

  /// A deal exists only when the run carries a percent.
  var hasDeal: Bool {
    (percent?.value ?? summary.percent?.value) != nil
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    production_run_id = try c.decode(String.self, forKey: .production_run_id)
    partner_id = try c.decodeIfPresent(String.self, forKey: .partner_id)
    percent = try c.decodeIfPresent(FlexibleDouble.self, forKey: .percent)
    sales = try c.decodeIfPresent([ProfitShareSale].self, forKey: .sales) ?? []
    settlements = try c.decodeIfPresent([ProfitShareSettlement].self, forKey: .settlements) ?? []
    summary = try c.decode(ProfitShareSummary.self, forKey: .summary)
  }
}

struct ProfitShareSale: Codable, Identifiable, Hashable {
  let id: String
  var quantity: FlexibleDouble?
  var unit_price: FlexibleDouble?
  var currency_code: String?
  var sold_at: Date?
  var note: String?
  /// "admin" (JYT recorded it) or "partner" (this partner reported it).
  var reported_by: String?

  var lineTotal: Double? {
    guard let q = quantity?.value, let p = unit_price?.value else { return nil }
    return q * p
  }
}

struct ProfitShareSettlement: Codable, Identifiable, Hashable {
  let id: String
  var amount: FlexibleDouble?
  var currency_code: String?
  var paid_at: Date?
  var reference: String?
  var receipt_url: String?
  var note: String?
}

struct ProfitShareSummary: Codable {
  var percent: FlexibleDouble?
  var currency_code: String?
  var run_quantity: FlexibleDouble?
  var sold_quantity: FlexibleDouble?
  var unsold_quantity: FlexibleDouble?
  var gross_sales: FlexibleDouble?
  /// nil = no deal on this run (not zero).
  var owed: FlexibleDouble?
  var paid: FlexibleDouble?
  var balance: FlexibleDouble?
  /// none | no_sales | open | settled | overpaid
  var status: String?
  /// Rows in mixed currencies — the backend refuses to add them up.
  var currency_mismatch: Bool?
  var working: [String]?
}

struct ProfitShareResponse: Codable {
  let profit_share: ProfitShare
}

struct RecordProfitShareSaleResponse: Codable {
  let sale: ProfitShareSale?
  let profit_share: ProfitShare
}

/// POST /partners/production-runs/:id/profit-share/sales body.
struct RecordProfitShareSaleBody: Codable {
  var quantity: Double
  var unit_price: Double
  var currency_code: String?
  /// ISO-8601 with an offset — the backend's `z.string().datetime({ offset: true })`.
  var sold_at: String?
  var note: String?
}
