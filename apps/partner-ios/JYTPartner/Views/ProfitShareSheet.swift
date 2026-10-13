import SwiftUI

/// #2401 — the run's profit share, as a sheet on the run screen (not a
/// pushed screen). The partner sees the same sales, payments and amount
/// owed as JYT does, and can report a sale. Every sum comes from the
/// server's summary; the app never adds money up itself.
struct ProfitShareSheet: View {
  let runID: String
  /// Called with the refreshed profit share after a reported sale, so the
  /// run screen's button stays in step.
  let onUpdate: (ProfitShare) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var share: ProfitShare

  // Report-a-sale form
  @State private var quantityText = ""
  @State private var unitPriceText = ""
  @State private var soldOn = Date()
  @State private var note = ""
  @State private var submitting = false
  @State private var formError: String?
  @State private var justReported = false

  init(runID: String, share: ProfitShare, onUpdate: @escaping (ProfitShare) -> Void) {
    self.runID = runID
    self.onUpdate = onUpdate
    _share = State(initialValue: share)
  }

  private var summary: ProfitShareSummary { share.summary }
  private var currency: String { summary.currency_code ?? "inr" }
  private var mismatch: Bool { summary.currency_mismatch == true }

  var body: some View {
    NavigationStack {
      List {
        summarySection
        salesSection
        paymentsSection
        reportSection
      }
      .navigationTitle("Profit share")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .refreshable { await reload() }
    }
  }

  // MARK: - Summary

  @ViewBuilder private var summarySection: some View {
    Section {
      if let percent = summary.percent?.value ?? share.percent?.value {
        LabeledContent("Share", value: "\(Self.quantity(percent))% of sales")
      }
      LabeledContent("Sold", value: soldText)
      if let status = summary.status {
        LabeledContent("Status") { ProfitShareStatusBadge(status: status) }
      }

      if mismatch {
        Label(
          "These sales and payments are in more than one currency, so the totals can't be added up. JYT will sort this out with you.",
          systemImage: "exclamationmark.triangle.fill"
        )
        .font(.footnote)
        .foregroundStyle(.orange)
      } else {
        LabeledContent("Gross sales", value: money(summary.gross_sales?.value))
        if let owed = summary.owed?.value {
          LabeledContent {
            Text(money(owed))
              .font(.title3.weight(.semibold))
              .foregroundStyle(.primary)
          } label: {
            Text("Owed to JYT").font(.body.weight(.semibold))
          }
        }
        LabeledContent("Paid", value: money(summary.paid?.value))
        if let balance = summary.balance?.value {
          LabeledContent("Balance", value: money(balance))
        }
      }
    } footer: {
      if !mismatch, let lines = summary.working, !lines.isEmpty {
        Text(lines.joined(separator: "\n"))
          .font(.caption.monospaced())
      }
    }
  }

  private var soldText: String {
    let sold = Self.quantity(summary.sold_quantity?.value ?? 0)
    if let total = summary.run_quantity?.value {
      return "\(sold) of \(Self.quantity(total))"
    }
    return sold
  }

  // MARK: - Sales

  @ViewBuilder private var salesSection: some View {
    Section("Sales") {
      if share.sales.isEmpty {
        Text("No sales reported yet.")
          .font(.footnote).foregroundStyle(.tertiary)
      } else {
        ForEach(share.sales) { sale in
          SaleRow(sale: sale, fallbackCurrency: currency)
        }
      }
    }
  }

  // MARK: - Payments

  @ViewBuilder private var paymentsSection: some View {
    Section("Payments") {
      if share.settlements.isEmpty {
        Text("No payments recorded yet.")
          .font(.footnote).foregroundStyle(.tertiary)
      } else {
        ForEach(share.settlements) { payment in
          SettlementRow(settlement: payment, fallbackCurrency: currency)
        }
      }
    }
  }

  // MARK: - Report a sale

  @ViewBuilder private var reportSection: some View {
    Section {
      TextField("Pieces sold", text: $quantityText)
        .keyboardType(.decimalPad)
      TextField("Price per piece (\(currency.uppercased()))", text: $unitPriceText)
        .keyboardType(.decimalPad)
      DatePicker("Sold on", selection: $soldOn, in: ...Date(), displayedComponents: .date)
      TextField("Note (optional)", text: $note, axis: .vertical)
        .lineLimit(1...4)

      if let formError {
        Label(formError, systemImage: "exclamationmark.circle.fill")
          .font(.footnote)
          .foregroundStyle(.red)
      } else if justReported {
        Label("Sale reported.", systemImage: "checkmark.circle.fill")
          .font(.footnote)
          .foregroundStyle(.green)
      }

      Button {
        Task { await submit() }
      } label: {
        HStack {
          Text("Report sale")
          if submitting {
            Spacer()
            ProgressView()
          }
        }
      }
      .disabled(submitting || parsedQuantity == nil || parsedUnitPrice == nil)
    } header: {
      Text("Report a sale")
    } footer: {
      Text("Report pieces as you sell them. Part of the run is fine.")
    }
  }

  private var parsedQuantity: Double? { Self.positive(quantityText) }
  private var parsedUnitPrice: Double? { Self.positive(unitPriceText) }

  @MainActor
  private func submit() async {
    guard !submitting else { return }
    guard let quantity = parsedQuantity else {
      formError = "Enter how many pieces you sold (more than 0)."
      return
    }
    guard let unitPrice = parsedUnitPrice else {
      formError = "Enter the price per piece (more than 0)."
      return
    }
    formError = nil
    justReported = false
    submitting = true
    defer { submitting = false }

    let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = RecordProfitShareSaleBody(
      quantity: quantity,
      unit_price: unitPrice,
      currency_code: nil, // the backend uses the run's currency
      sold_at: Self.isoWithOffset.string(from: soldOn),
      note: trimmedNote.isEmpty ? nil : trimmedNote
    )
    do {
      let result = try await PartnerAPI.shared.recordProfitShareSale(runId: runID, body: body)
      share = result.profit_share
      onUpdate(result.profit_share)
      quantityText = ""
      unitPriceText = ""
      note = ""
      soldOn = Date()
      justReported = true
    } catch {
      formError = (error as? LocalizedError)?.errorDescription
        ?? "The sale could not be reported."
    }
  }

  @MainActor
  private func reload() async {
    if let fresh = try? await PartnerAPI.shared.profitShare(runId: runID) {
      share = fresh
      onUpdate(fresh)
    }
  }

  // MARK: - Formatting

  private func money(_ amount: Double?) -> String {
    guard let amount else { return "N/A" }
    return Self.currency.string(amount, code: currency)
  }

  static func positive(_ text: String) -> Double? {
    let normalized = text
      .trimmingCharacters(in: .whitespaces)
      .replacingOccurrences(of: ",", with: ".")
    guard let value = Double(normalized), value.isFinite, value > 0 else { return nil }
    return value
  }

  static func quantity(_ value: Double) -> String {
    quantityFormatter.string(from: NSNumber(value: value)) ?? "\(value)"
  }

  /// "2026-10-13T10:00:00+05:30" — ISO-8601 WITH the device's offset, which
  /// the backend's `datetime({ offset: true })` requires.
  static let isoWithOffset: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    f.timeZone = .current
    return f
  }()

  static let currency: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "INR"
    return f
  }()

  static let quantityFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = 2
    return f
  }()

  static let day: DateFormatter = {
    let f = DateFormatter()
    f.dateStyle = .medium
    f.timeStyle = .none
    return f
  }()
}

// MARK: - Rows

private struct SaleRow: View {
  let sale: ProfitShareSale
  let fallbackCurrency: String

  private var code: String { sale.currency_code ?? fallbackCurrency }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(sale.sold_at.map { ProfitShareSheet.day.string(from: $0) } ?? "Undated")
          .font(.body.weight(.medium))
        Spacer()
        Text(sale.lineTotal.map { ProfitShareSheet.currency.string($0, code: code) } ?? "N/A")
          .font(.body.weight(.medium))
      }
      HStack {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
        Text(reporter)
          .font(.caption2)
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(Color.gray.opacity(0.15), in: Capsule())
          .foregroundStyle(.secondary)
      }
      if let note = sale.note, !note.isEmpty {
        Text(note).font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var detail: String {
    let qty = ProfitShareSheet.quantity(sale.quantity?.value ?? 0)
    let price = sale.unit_price?.value.map { ProfitShareSheet.currency.string($0, code: code) } ?? "N/A"
    return "\(qty) × \(price)"
  }

  private var reporter: String {
    switch sale.reported_by {
    case "admin": return "JYT"
    case "partner": return "You"
    default: return sale.reported_by?.capitalized ?? "Unknown"
    }
  }
}

private struct SettlementRow: View {
  let settlement: ProfitShareSettlement
  let fallbackCurrency: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(settlement.paid_at.map { ProfitShareSheet.day.string(from: $0) } ?? "Undated")
          .font(.body.weight(.medium))
        Spacer()
        Text(
          settlement.amount?.value.map {
            ProfitShareSheet.currency.string($0, code: settlement.currency_code ?? fallbackCurrency)
          } ?? "N/A"
        )
        .font(.body.weight(.medium))
      }
      if let reference = settlement.reference, !reference.isEmpty {
        Text("Ref: \(reference)").font(.caption).foregroundStyle(.secondary)
      }
      if let note = settlement.note, !note.isEmpty {
        Text(note).font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}

struct ProfitShareStatusBadge: View {
  let status: String

  var body: some View {
    Text(label)
      .font(.caption.weight(.medium))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(tint.opacity(0.15), in: Capsule())
      .foregroundStyle(tint)
  }

  private var label: String {
    switch status {
    case "none": return "No deal"
    case "no_sales": return "No sales yet"
    case "open": return "Open"
    case "settled": return "Settled"
    case "overpaid": return "Overpaid"
    default: return status.replacingOccurrences(of: "_", with: " ").capitalized
    }
  }

  private var tint: Color {
    switch status {
    case "open": return .orange
    case "settled": return .green
    case "overpaid": return .blue
    default: return .secondary
    }
  }
}
