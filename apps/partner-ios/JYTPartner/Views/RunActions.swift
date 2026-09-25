import SwiftUI

// The partner's next action on a run, ported from the web
// (`apps/partner-ui/src/lib/run-phase.ts::getRunNextAction`). Status keys
// the button, not the phase — an action that looks available and then
// fails is worse than one never offered.

enum RunAction: String, CaseIterable {
  case accept
  case start
  case finish
  case complete

  var label: String {
    switch self {
    case .accept: return "Accept this run"
    case .start: return "Start production"
    case .finish: return "Mark finished"
    case .complete: return "Complete the run"
    }
  }

  func hint(isSample: Bool) -> String {
    switch self {
    case .accept:
      return "Review the details and confirm you'll handle this work."
    case .start:
      return "Mark it started when you begin, so timelines stay accurate."
    case .finish:
      return isSample
        ? "Log the materials you used as you go — this sets the design's cost estimate. Mark finished when done."
        : "Once finished, our team reviews the work before final completion."
    case .complete:
      return isSample
        ? "Log final material usage and your cost estimate. This drives pricing — be thorough."
        : "Log any remaining material usage and your production cost to finalise."
    }
  }
}

/// Mirrors getRunNextAction: which single action the partner owes, if any.
func nextRunAction(for run: ProductionRun) -> RunAction? {
  let status = run.status ?? ""
  if status == "cancelled" || status == "completed" {
    return nil
  }
  if status == "sent_to_partner" {
    return .accept
  }
  if status == "in_progress" {
    if run.started_at == nil { return .start }
    if run.finished_at == nil { return .finish }
    return .complete
  }
  return nil
}

extension Notification.Name {
  /// Fired after a successful run mutation so the list screens reload.
  static let runDidMutate = Notification.Name("partnerRunDidMutate")
}

// MARK: - Next step block

/// The "Your next step" banner the partner-ui pins at the top of the page
/// (run-next-action.tsx) — heading, hint, one full-width button. Terminal
/// runs get the plain "nothing further" copy instead of silence.
struct RunNextStepSection: View {
  let run: ProductionRun
  let isSample: Bool
  var onAction: (RunAction) -> Void

  var body: some View {
    if let action = nextRunAction(for: run) {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Text("Your next step")
            .font(.body.weight(.semibold))
          Text(action.hint(isSample: isSample))
            .font(.footnote)
            .foregroundStyle(.secondary)
          Button {
            onAction(action)
          } label: {
            Text(action.label)
              .frame(maxWidth: .infinity)
              .font(.body.weight(.semibold))
          }
          .buttonStyle(.borderedProminent)
        }
        .padding(.vertical, 4)
      }
    } else if run.status == "completed" {
      Section {
        Text("This run is complete. Nothing further is needed from you.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    } else if run.status == "cancelled" {
      Section {
        Text("This run was cancelled. No action is needed.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    }
  }
}

// MARK: - Finish sheet (FinishRunForm)

struct FinishRunSheet: View {
  let pendingTasks: [RunTask]
  let isSample: Bool
  let consumptionCount: Int
  let onConfirm: (String?) -> Void
  @Environment(\.dismiss) private var dismiss

  @State private var notes = ""
  @State private var acknowledgedPending = false

  private var hasPending: Bool { !pendingTasks.isEmpty }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text("The design will move to Technical Review for admin to inspect.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        if isSample && consumptionCount == 0 {
          Section {
            Label {
              VStack(alignment: .leading, spacing: 2) {
                Text("No materials logged yet").font(.footnote.weight(.semibold))
                Text("For sample runs, material usage data is needed for cost estimation. Consider logging materials before finishing.")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
            } icon: {
              Image(systemName: "exclamationmark.circle")
                .foregroundStyle(.orange)
            }
          }
        }

        if hasPending {
          Section("\(pendingTasks.count) task(s) still pending") {
            ForEach(pendingTasks) { task in
              Text(task.title ?? "Task")
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Toggle(
              "I confirm these tasks are completed or not needed",
              isOn: $acknowledgedPending
            )
            .font(.footnote)
          }
        }

        Section("Notes (optional)") {
          TextEditor(text: $notes)
            .frame(minHeight: 80)
        }
      }
      .navigationTitle("Mark as Finished")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Confirm") {
            onConfirm(notes.isEmpty ? nil : notes)
            dismiss()
          }
          .disabled(hasPending && !acknowledgedPending)
        }
      }
    }
  }
}

// MARK: - Complete sheet (CompleteRunForm essentials)

/// The rejection-reason vocabulary, verbatim from the web form.
enum RejectionReason: String, CaseIterable, Identifiable {
  case stitchingDefect = "stitching_defect"
  case fabricFlaw = "fabric_flaw"
  case colorMismatch = "color_mismatch"
  case sizingError = "sizing_error"
  case printDefect = "print_defect"
  case materialDamage = "material_damage"
  case qualityBelowStandard = "quality_below_standard"
  case other = "other"

  var id: String { rawValue }

  var label: String {
    switch self {
    case .stitchingDefect: return "Stitching defect"
    case .fabricFlaw: return "Fabric flaw"
    case .colorMismatch: return "Color mismatch"
    case .sizingError: return "Sizing error"
    case .printDefect: return "Print defect"
    case .materialDamage: return "Material damage"
    case .qualityBelowStandard: return "Quality below standard"
    case .other: return "Other"
    }
  }
}

enum CostType: String, CaseIterable, Identifiable {
  case perUnit = "per_unit"
  case total = "total"

  var id: String { rawValue }

  var label: String {
    switch self {
    case .perUnit: return "Per unit"
    case .total: return "Total"
    }
  }
}

/// One material row in the Complete form: used toggle + quantity + unit cost.
private struct MaterialUsage: Identifiable {
  let item: DesignInventoryItem
  var used = false
  var quantityText = ""
  var unitCostText = ""

  var id: String { item.id }

  var quantity: Double? {
    let v = Double(quantityText.trimmingCharacters(in: .whitespaces))
    return (v ?? 0) > 0 ? v : nil
  }

  var unitCost: Double? {
    let v = Double(unitCostText.trimmingCharacters(in: .whitespaces))
    return (v ?? 0) > 0 ? v : nil
  }
}

struct CompleteRunSheet: View {
  let orderedQuantity: Int
  /// The design's inventory items — the Complete form's material options
  /// (the web's resolveRunMaterialOptions). Logged as consumptions.
  var materials: [DesignInventoryItem] = []
  let onConfirm: (PartnerAPI.CompleteRunBody) -> Void
  @Environment(\.dismiss) private var dismiss

  @State private var producedQty: String
  @State private var rejectedQty = ""
  @State private var rejectionReason: RejectionReason?
  @State private var rejectionNotes = ""
  @State private var costText = ""
  @State private var costType: CostType?
  @State private var notes = ""
  @State private var shortfallExplanation = ""
  @State private var usage: [MaterialUsage] = []

  init(
    orderedQuantity: Int,
    materials: [DesignInventoryItem] = [],
    onConfirm: @escaping (PartnerAPI.CompleteRunBody) -> Void
  ) {
    self.orderedQuantity = orderedQuantity
    self.materials = materials
    self.onConfirm = onConfirm
    _producedQty = State(initialValue: String(max(orderedQuantity, 0)))
    _usage = State(initialValue: materials.map { MaterialUsage(item: $0) })
  }

  private var produced: Int { Int(producedQty) ?? 0 }
  private var rejected: Int { Int(rejectedQty) ?? 0 }
  private var cost: Double? {
    let value = Double(costText.trimmingCharacters(in: .whitespaces))
    return (value ?? 0) > 0 ? value : nil
  }

  /// produced + rejected must cover the order unless the shortfall is
  /// claimed AND explained — mirrors the backend gate (#1271).
  private var shortfall: Bool {
    orderedQuantity > 0 && produced + rejected < orderedQuantity
  }

  private var consumptions: [PartnerAPI.ConsumptionEntry]? {
    let entries = usage.compactMap { row -> PartnerAPI.ConsumptionEntry? in
      guard row.used, let qty = row.quantity else { return nil }
      return PartnerAPI.ConsumptionEntry(
        inventory_item_id: row.item.id,
        quantity: qty,
        unit_cost: row.unitCost,
        unit_of_measure: row.item.unit_of_measure,
        consumption_type: "production",
        notes: nil
      )
    }
    return entries.isEmpty ? nil : entries
  }

  private var canSubmit: Bool {
    guard produced >= 0, rejected >= 0 else { return false }
    if rejected > 0 && rejectionReason == nil { return false }
    if let cost, costType == nil { return false }
    if shortfall && shortfallExplanation.trimmingCharacters(in: .whitespaces).isEmpty {
      return false
    }
    return true
  }

  var body: some View {
    NavigationStack {
      Form {
        Section("Output") {
          HStack {
            Text("Ordered")
            Spacer()
            Text("\(orderedQuantity)").foregroundStyle(.secondary)
          }
          LabeledContent("Produced") {
            TextField("0", text: $producedQty)
              .keyboardType(.numberPad)
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 90)
          }
          LabeledContent("Rejected") {
            TextField("0", text: $rejectedQty)
              .keyboardType(.numberPad)
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 90)
          }
        }

        if rejected > 0 {
          Section("Rejection details") {
            Picker("Reason", selection: $rejectionReason) {
              Text("Select…").tag(RejectionReason?.none)
              ForEach(RejectionReason.allCases) { reason in
                Text(reason.label).tag(RejectionReason?.some(reason))
              }
            }
            TextField("Rejection notes", text: $rejectionNotes)
          }
        }

        if !usage.isEmpty {
          Section {
            ForEach($usage) { $row in
              VStack(alignment: .leading, spacing: 6) {
                Toggle(row.item.displayName, isOn: $row.used)
                  .font(.body)
                if row.used {
                  HStack {
                    TextField("Quantity used", text: $row.quantityText)
                      .keyboardType(.decimalPad)
                    Text(row.item.unit_of_measure ?? "units")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  TextField("Unit cost (optional)", text: $row.unitCostText)
                    .keyboardType(.decimalPad)
                }
              }
            }
          } header: {
            Text("Materials used")
          } footer: {
            Text("The design's bill of materials. Log what this run actually consumed — it drives the cost rollup.")
          }
        }

        if shortfall {
          Section {
            Label(
              "Produced + rejected is less than ordered. Explain the shortfall — the completion will be recorded with it.",
              systemImage: "exclamationmark.triangle"
            )
            .font(.footnote)
            .foregroundStyle(.orange)
            TextField("Why the shortfall?", text: $shortfallExplanation)
          } header: {
            Text("Shortfall")
          }
        }

        Section {
          LabeledContent("Your cost") {
            TextField("e.g. 1500", text: $costText)
              .keyboardType(.decimalPad)
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 120)
          }
          Picker("Cost type", selection: $costType) {
            Text("Select…").tag(CostType?.none)
            ForEach(CostType.allCases) { type in
              Text(type.label).tag(CostType?.some(type))
            }
          }
        } header: {
          Text("Cost")
        } footer: {
          Text("Per unit or for the whole run. Drives the design's pricing — leave blank if unsure.")
        }

        Section("Notes (optional)") {
          TextEditor(text: $notes)
            .frame(minHeight: 70)
        }
      }
      .navigationTitle("Complete the run")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Submit") {
            var combinedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            if shortfall {
              let explanation = "Shortfall explanation: \(shortfallExplanation.trimmingCharacters(in: .whitespacesAndNewlines))"
              combinedNotes = combinedNotes.isEmpty ? explanation : "\(combinedNotes)\n\(explanation)"
            }
            onConfirm(PartnerAPI.CompleteRunBody(
              produced_quantity: produced,
              rejected_quantity: rejected > 0 ? rejected : nil,
              rejection_reason: rejectionReason?.rawValue,
              rejection_notes: rejectionNotes.isEmpty ? nil : rejectionNotes,
              partner_cost_estimate: cost,
              cost_type: costType?.rawValue,
              allow_shortfall: shortfall ? true : nil,
              notes: combinedNotes.isEmpty ? nil : combinedNotes,
              consumptions: consumptions
            ))
            dismiss()
          }
          .disabled(!canSubmit)
        }
      }
    }
  }
}
