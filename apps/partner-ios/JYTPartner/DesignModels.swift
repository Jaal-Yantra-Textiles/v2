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
  var quantity: Int?
  var design_id: String?
  var accepted_at: Date?
  var started_at: Date?
  var finished_at: Date?
  var completed_at: Date?
  var created_at: Date?
  var updated_at: Date?
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
