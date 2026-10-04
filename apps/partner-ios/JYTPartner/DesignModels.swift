import Foundation

// Design + production-run models, mirrored from the partner API:
//   GET /partners/designs            (apps/backend/src/api/partners/designs/route.ts)
//   GET /partners/designs/:id        ([designId]/route.ts — full design +
//                                    partner_info derived from production runs)
//   GET /partners/production-runs    (list, design_id filter)
//   GET /partners/production-runs/:id (detail + tasks)
// and the design module's own columns (modules/designs/models/design.ts):
// media_files json, moodboard scene json, colors + size_sets relations.

// MARK: - Designs

struct PartnerDesignRow: Codable, Identifiable, Hashable {
  let id: String
  var name: String?
  var status: String?
  var thumbnail_url: String?
  var created_at: Date?
  var updated_at: Date?
  var partner_info: PartnerInfo?
  /// owned | assigned | shared — derived server-side, never re-derived here.
  var partner_engagement: String?
  var has_partner_run: Bool?
  var partner_run_count: Int?
}

struct PartnerDesignListResponse: Codable {
  let designs: [PartnerDesignRow]
  let count: Int
  let limit: Int
  let offset: Int
}

/// The partner_status block both design routes emit. Derived entirely from
/// the partner's production runs on the design — the completion timestamps
/// included (apps/backend/src/api/partners/designs/[designId]/route.ts:172).
struct PartnerInfo: Codable, Hashable {
  var partner_status: String?
  var partner_phase: String?
  var partner_started_at: Date?
  var partner_finished_at: Date?
  var partner_completed_at: Date?
  var workflow_tasks_count: Int?
}

/// media_files json on the design: `[{id?, url, isThumbnail?}]`.
struct MediaFile: Codable, Identifiable, Hashable {
  var id: String?
  var url: String
  var isThumbnail: Bool?
}

/// An Excalidraw moodboard scene, kept deliberately loose — the mobile app
/// reads only the embedded images (files[key].dataURL referenced by image
/// elements), never the geometry.
struct MoodboardScene: Codable, Hashable {
  struct Element: Codable, Hashable {
    var type: String?
    var fileId: String?
  }
  struct File: Codable, Hashable {
    var dataURL: String?
    var mimeType: String?
  }
  var elements: [Element]?
  var files: [String: File]?

  /// (key, dataURL) pairs for every image element on the board.
  var imageDataURLs: [(id: String, data: String)] {
    guard let elements = elements, let files = files else { return [] }
    return elements.compactMap { element in
      guard element.type == "image", let key = element.fileId,
            let data = files[key]?.dataURL else { return nil }
      return (key, data)
    }
  }
}

struct DesignColorRow: Codable, Identifiable, Hashable {
  let id: String
  var name: String
  var hex_code: String
  var usage_notes: String?
  var order: Int?
}

struct DesignSizeSetRow: Codable, Identifiable, Hashable {
  let id: String
  var size_label: String
  /// measurement point -> value, stored as JSON; values may be numbers.
  var measurements: [String: FlexibleDouble]?
}

/// An inventory item linked to the design (its bill of materials) — the
/// material options the Complete form offers. The design detail read
/// returns these with raw_materials + location_levels expanded; we only
/// need the naming fields.
struct DesignInventoryItem: Codable, Identifiable, Hashable {
  let id: String
  var title: String?
  var sku: String?
  var unit_of_measure: String?

  var displayName: String { title ?? sku ?? "Material" }
}

/// The full design record from GET /partners/designs/:id. Fields the
/// partner-UI treats as Record<string, any> are decoded leniently here —
/// everything optional, unknown keys dropped.
struct DesignDetail: Codable, Identifiable, Hashable {
  let id: String
  var name: String?
  var description: String?
  var status: String?
  var design_type: String?
  var product_type: String?
  var concept_theme: String?
  var aesthetic_keywords: [String]?
  var designer_notes: String?
  var thumbnail_url: String?
  var media_files: [MediaFile]?
  var moodboard: MoodboardScene?
  var colors: [DesignColorRow]?
  var size_sets: [DesignSizeSetRow]?
  var inventory_items: [DesignInventoryItem]?
  var estimated_cost: FlexibleDouble?
  var cost_currency: String?
  var partner_info: PartnerInfo?
  var is_owner: Bool?
  var created_at: Date?
  var updated_at: Date?
}

/// One uploaded file, as `POST /partners/production-runs/:id/media` and the
/// design media route return them.
struct UploadedFile: Codable, Hashable {
  var id: String?
  var url: String
}

struct UploadFilesResponse: Codable {
  let files: [UploadedFile]
}

/// The attach payload's media entry (`.../media/attach`).
struct AttachMediaFile: Codable {
  var id: String?
  var url: String
  var isThumbnail: Bool?
}

struct AttachMediaBody: Codable {
  var media_files: [AttachMediaFile]
}

// MARK: - Production runs

struct ProductionRun: Codable, Identifiable, Hashable {
  let id: String
  var status: String?
  var run_type: String?
  var role: String?
  /// The ORDERED quantity — a float column on the backend, and the payout
  /// multiplier for a per-piece cost. Show it with `quantityText`.
  var quantity: Double?
  var produced_quantity: Double?
  /// The partner's stated cost, its basis (`per_unit` | `total`) and the
  /// currency it is in (lowercased code; null = not stated → INR).
  var partner_cost_estimate: Double?
  var cost_type: String?
  var cost_currency: String?
  var design_id: String?
  var accepted_at: Date?
  var started_at: Date?
  var finished_at: Date?
  var completed_at: Date?
  var created_at: Date?
  var updated_at: Date?
  /// The sizes/colours the run was commissioned for (#2271).
  var snapshot: RunSnapshot?
  var planned_output: OutputLines?
}

extension ProductionRun {
  /// "12" for a whole quantity, "12.5" otherwise.
  var quantityText: String? { quantity.map(CompletionSplit.format) }

  /// The currency the run's cost is in, uppercased — INR when unstated
  /// (the backend's own fallback when it prices the run).
  var costCurrencyCode: String {
    let code = (cost_currency ?? "").trimmingCharacters(in: .whitespaces)
    return code.isEmpty ? "INR" : code.uppercased()
  }
}

/// `GET /partners/production-runs/:id/cost-summary` — the same numbers the
/// admin sees (`computeRunCostSummary`). Only the fields the app shows.
struct RunCostSummary: Codable {
  struct Partner: Codable {
    var estimate: Double?
    var cost_type: String?
    var total: Double?
  }
  struct Material: Codable {
    var total: Double?
  }
  var currency: String?
  var quantity: Double?
  var produced_quantity: Double?
  var partner: Partner?
  var material: Material?
  var grand_total: Double?
  var cost_per_unit: Double?
}

struct RunCostSummaryResponse: Codable {
  let cost_summary: RunCostSummary
}

/// `GET /partners/production-runs/:id/consumption-logs` — only the count
/// is read (the Finish sheet's "no materials logged" nudge).
struct ConsumptionLogCountResponse: Codable {
  let count: Int
}

struct ProductionRunListResponse: Codable {
  let production_runs: [ProductionRun]
  let count: Int
  let limit: Int
  let offset: Int
}

struct RunTask: Codable, Identifiable, Hashable {
  let id: String?
  var title: String?
  var status: String?
  var priority: String?
  var start_date: Date?
  var end_date: Date?
}

struct ProductionRunDetail: Codable {
  let production_run: ProductionRun
  var tasks: [RunTask]?
}

// MARK: - Lenient JSON scalars

/// bigNumber columns and other numbers that may arrive as Double, Int, or
/// numeric String — Medusa's query.graph is inconsistent here.
struct FlexibleDouble: Codable, Hashable {
  let value: Double?

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let d = try? container.decode(Double.self) {
      value = d
    } else if let i = try? container.decode(Int.self) {
      value = Double(i)
    } else if let s = try? container.decode(String.self) {
      value = Double(s)
    } else {
      value = nil
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(value)
  }
}

// MARK: - Completion split (#2271)

// #2271 — which sizes/colours a completed run made. The iOS twin of
// partner-ui's lib/completion-split.ts.
//
// The run's snapshot states the sizes and colours it was commissioned for.
// When it states several, the backend refuses Complete unless the partner
// says how many of each were made (or the run's plan already adds up to the
// good units), so goods reach stock as the right variant. The backend
// re-checks all of this; this only decides what the sheet shows and sends.

struct OutputLine: Codable, Hashable {
  var size_label: String?
  var color: String?
  var quantity: Double
}

/// The parts of a run snapshot the split reads. Decodes leniently: an odd
/// snapshot becomes empty instead of failing the whole run.
struct RunSnapshot: Codable, Hashable {
  var sizes: [String] = []
  var colors: [String] = []

  private enum Keys: String, CodingKey { case size_sets, colors }
  private struct Named: Decodable {
    var size_label: String?
    var name: String?
  }

  init(sizes: [String] = [], colors: [String] = []) {
    self.sizes = sizes
    self.colors = colors
  }

  init(from decoder: Decoder) throws {
    guard let c = try? decoder.container(keyedBy: Keys.self) else { return }
    let sizeRows = (try? c.decodeIfPresent([Named].self, forKey: .size_sets)) ?? nil
    let colorRows = (try? c.decodeIfPresent([Named].self, forKey: .colors)) ?? nil
    sizes = CompletionSplit.dedupe((sizeRows ?? []).map { $0.size_label ?? "" })
    colors = CompletionSplit.dedupe((colorRows ?? []).map { $0.name ?? "" })
  }

  func encode(to encoder: Encoder) throws {}
}

/// A run's planned_output, skipping malformed lines.
struct OutputLines: Codable, Hashable {
  var lines: [OutputLine] = []

  init(_ lines: [OutputLine] = []) { self.lines = lines }

  init(from decoder: Decoder) throws {
    guard var c = try? decoder.unkeyedContainer() else { return }
    while !c.isAtEnd {
      if let line = try? c.decode(OutputLine.self) {
        lines.append(line)
      } else {
        _ = try? c.decode(Skip.self)
      }
    }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.unkeyedContainer()
    try c.encode(contentsOf: lines)
  }

  private struct Skip: Decodable {}
}

struct SplitCombo: Hashable, Identifiable {
  var size_label: String?
  var color: String?
  var id: String { "\(size_label ?? "")\u{0}\(color ?? "")" }
  var label: String { [size_label, color].compactMap { $0 }.joined(separator: " · ") }
}

enum CompletionSplit {
  static func dedupe(_ values: [String]) -> [String] {
    var out: [String] = []
    for raw in values {
      let v = raw.trimmingCharacters(in: .whitespaces)
      if !v.isEmpty && !out.contains(v) { out.append(v) }
    }
    return out
  }

  static func needed(_ s: RunSnapshot) -> Bool { s.sizes.count > 1 || s.colors.count > 1 }

  /// Every size × colour combination the run is for, one row each.
  static func combos(_ s: RunSnapshot) -> [SplitCombo] {
    let sizes: [String?] = s.sizes.isEmpty ? [nil] : s.sizes
    let colors: [String?] = s.colors.isEmpty ? [nil] : s.colors
    return sizes.flatMap { size in colors.map { SplitCombo(size_label: size, color: $0) } }
  }

  /// Starting quantities: the plan when it adds up to `target` (the good
  /// units); otherwise blank.
  static func initial(planned: [OutputLine], snapshot: RunSnapshot, target: Double) -> [String: String] {
    var values: [String: String] = [:]
    if !planned.isEmpty && planned.reduce(0, { $0 + $1.quantity }) == target {
      for line in planned {
        let size = line.size_label?.trimmingCharacters(in: .whitespaces)
        let color = line.color?.trimmingCharacters(in: .whitespaces)
        let combo = SplitCombo(
          size_label: (size?.isEmpty ?? true) ? nil : size,
          color: (color?.isEmpty ?? true) ? nil : color)
        values[combo.id] = format(line.quantity)
      }
    }
    for combo in combos(snapshot) where values[combo.id] == nil { values[combo.id] = "" }
    return values
  }

  /// The lines to send as produced_output, with their total.
  static func plan(_ s: RunSnapshot, values: [String: String]) -> (lines: [OutputLine], total: Double) {
    let lines = combos(s).compactMap { combo -> OutputLine? in
      let q = Double(values[combo.id]?.trimmingCharacters(in: .whitespaces) ?? "") ?? 0
      return q > 0 ? OutputLine(size_label: combo.size_label, color: combo.color, quantity: q) : nil
    }
    return (lines, lines.reduce(0) { $0 + $1.quantity })
  }

  static func format(_ q: Double) -> String {
    q.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(q)) : String(q)
  }
}
