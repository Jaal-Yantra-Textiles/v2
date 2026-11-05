import Foundation

// A COLLATED design work-order ("bundle", #2500): one order, N designs, each
// with its own run and its own next step. Ported from the web
// (`apps/partner-ui/src/lib/order-kind.ts`, `.../collated-actions.ts`) so the
// per-design rows and the "all designs" bar can never disagree about what a
// design owes — both read `nextRunAction(for:)`.

/// `unified_order_kind` — the typed 1:1 sidecar saying how the order was built.
struct UnifiedOrderKind: Codable, Hashable {
  var kind: String?
}

/// The few order-metadata keys the app reads. Lenient: metadata is a free
/// blob, so a key of an unexpected type reads as absent, never fails the order.
struct OrderMetadata: Codable, Hashable {
  var collated_design_order: Bool?

  init(collated_design_order: Bool? = nil) {
    self.collated_design_order = collated_design_order
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    collated_design_order = try? c.decodeIfPresent(Bool.self, forKey: .collated_design_order)
  }
}

/// A collated order's line names its design and run on `metadata`.
struct OrderLineMetadata: Codable, Hashable {
  var design_id: String?
  var production_run_id: String?

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    design_id = try? c.decodeIfPresent(String.self, forKey: .design_id)
    production_run_id = try? c.decodeIfPresent(String.self, forKey: .production_run_id)
  }
}

extension PartnerOrder {
  /// Mirrors isCollatedOrder. 🔴 An absent kind is NOT per-run: orders written
  /// before the sidecar existed fall back to the metadata flag, else the
  /// single-design screen would hide every design but the first.
  var isCollated: Bool {
    switch unified_order_kind?.kind {
    case "collated": return true
    case "per_run": return false
    default: return metadata?.collated_design_order == true
    }
  }
}

/// One design of a bundle: its order line plus the run that line belongs to.
struct BundleDesign: Identifiable, Hashable {
  /// The order line id — stable across reloads.
  let id: String
  /// What the partner calls it — the line title, else the design id.
  let name: String
  let thumbnail: String?
  let quantity: Int
  let designID: String
  let runID: String
  /// Nil until the run has loaded (or when it failed to load).
  var run: ProductionRun?
  var tasks: [RunTask] = []

  var nextAction: RunAction? { run.flatMap { nextRunAction(for: $0) } }

  /// Tasks still open — the ones Finish asks the partner to acknowledge.
  var pendingTasks: [RunTask] {
    tasks.filter { !["completed", "cancelled"].contains($0.status ?? "") }
  }
}

/// One "all designs" step: the action and exactly the designs that owe it.
struct BundleBulk: Identifiable {
  let action: RunAction
  let designs: [BundleDesign]
  var id: String { action.rawValue }
}

enum BundleActions {
  /// The lines that are a bundle's designs — those naming both a run and a design.
  static func designs(
    items: [PartnerOrderItem],
    runs: [String: ProductionRunDetail]
  ) -> [BundleDesign] {
    items.compactMap { item in
      guard let runID = item.metadata?.production_run_id,
            let designID = item.metadata?.design_id else { return nil }
      let detail = runs[runID]
      return BundleDesign(
        id: item.id,
        name: item.title ?? designID,
        thumbnail: item.thumbnail,
        quantity: item.quantity,
        designID: designID,
        runID: runID,
        run: detail?.production_run,
        tasks: detail?.tasks ?? []
      )
    }
  }

  /// Each action some design owes, with the designs owing it, in lifecycle
  /// order. Complete is left out: it is a per-design form (cost, materials).
  static func bulk(_ designs: [BundleDesign]) -> [BundleBulk] {
    [RunAction.accept, .start, .finish].compactMap { action in
      let owing = designs.filter { $0.nextAction == action }
      return owing.isEmpty ? nil : BundleBulk(action: action, designs: owing)
    }
  }

  /// What a batch did, naming each design that didn't go through and why.
  /// Nil when everything went through.
  static func describeFailures(
    total: Int,
    failed: [(name: String, message: String)]
  ) -> String? {
    guard !failed.isEmpty else { return nil }
    let succeeded = total - failed.count
    let head = succeeded > 0 ? "\(succeeded) of \(total) went through." : "None went through."
    return "\(head) " + failed.map { "\($0.name): \($0.message)" }.joined(separator: "; ")
  }
}

extension RunAction {
  /// The short per-design button label (the web's ACTION_LABEL).
  var shortLabel: String {
    switch self {
    case .accept: return "Accept"
    case .start: return "Start"
    case .finish: return "Finish"
    case .complete: return "Complete"
    }
  }

  /// "Accept all 9" — the bulk bar's button.
  func bulkLabel(count: Int) -> String { "\(shortLabel) all \(count)" }
}
