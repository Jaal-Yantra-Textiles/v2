import SwiftUI

/// An inventory order — the raw material the partner is commissioned to
/// supply. Leads with the next step (start / record the delivery), lists
/// the goods lines with fulfilled vs outstanding, and shows what charges
/// make the order payable. The receipt sheet is the mobile counterpart of
/// the partner-ui inventory-order-complete flow: per-line delivered
/// quantities, delivery date, tracking number, notes.
struct InventoryOrderDetailView: View {
  let orderID: String
  /// The row from the Inventory list — fallback while the detail loads.
  var listRow: PartnerInventoryOrder?

  @State private var detail: PartnerInventoryOrder?
  @State private var charges: InventoryOrderChargesResponse?
  @State private var loading = true
  @State private var errorText: String?

  @State private var actionError: String?
  @State private var acting = false
  @State private var showStartConfirm = false
  @State private var showReceiptSheet = false

  private var display: PartnerInventoryOrder {
    detail ?? listRow
      ?? PartnerInventoryOrder(
        id: orderID, status: "", quantity: nil, total_price: nil,
        currency_code: nil, expected_delivery_date: nil, order_date: nil,
        is_sample: nil, order_lines: nil, partner_info: nil,
        created_at: nil, updated_at: nil)
  }

  /// What the partner owes next, by status. `Ready for Delivery` onwards is
  /// waiting on the carrier/admin — nothing the partner can do here.
  private enum NextStep {
    case start
    case recordDelivery
    case none
  }

  private var nextStep: NextStep {
    switch display.statusEnum {
    case .pending: return .start
    case .processing, .partial: return .recordDelivery
    default: return .none
    }
  }

  var body: some View {
    List {
      if loading {
        Section { HStack { Spacer(); ProgressView(); Spacer() } }
      } else if let errorText, detail == nil && listRow == nil {
        Section {
          VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
              .font(.largeTitle).foregroundStyle(.red)
            Text(errorText).font(.subheadline)
              .foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Retry") { Task { await load() } }
              .buttonStyle(.bordered)
          }
          .frame(maxWidth: .infinity).padding(.vertical, 24)
        }
      } else {
        headerSection
        nextStepSection
        if let lines = display.order_lines, !lines.isEmpty {
          linesSection(lines)
        }
        if let charges, charges.charges.isEmpty == false {
          chargesSection(charges)
        }
        if let info = display.partner_info {
          partnerSection(info)
        }
      }
    }
    .listStyle(.insetGrouped)
    .navigationTitle("Inventory order")
    .navigationBarTitleDisplayMode(.inline)
    .task { await load() }
    .onReceive(NotificationCenter.default.publisher(for: .inventoryOrderDidMutate)) { _ in
      Task { await load() }
    }
    .alert("Action failed", isPresented: Binding(
      get: { actionError != nil },
      set: { if !$0 { actionError = nil } }
    )) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(actionError ?? "")
    }
    .confirmationDialog(
      "Start this order?",
      isPresented: $showStartConfirm,
      titleVisibility: .visible
    ) {
      Button("Start") { Task { await start() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Confirm you'll supply the goods on this order?")
    }
    .sheet(isPresented: $showReceiptSheet) {
      DeliveryReceiptSheet(order: display) {
        Task { await load() }
      }
    }
  }

  // MARK: - Sections

  private var headerSection: some View {
    Section {
      LabeledContent("Status") {
        if let status = display.statusEnum {
          InventoryOrderStatusBadge(status: status)
        } else {
          Text(display.status)
        }
      }
      if let quantity = display.quantity {
        LabeledContent("Goods ordered") {
          Text(Self.quantities.string(from: NSNumber(value: quantity)) ?? "—")
        }
      }
      if let outstanding = detail?.outstandingQuantity, outstanding > 0 {
        LabeledContent("Still to deliver") {
          Text(Self.quantities.string(from: NSNumber(value: outstanding)) ?? "—")
            .foregroundStyle(.orange)
        }
      }
      if let total = display.total_price {
        LabeledContent("Total") {
          Text(Self.currency.string(total, code: display.currency_code ?? ""))
        }
      }
      if let date = display.order_date {
        LabeledContent("Ordered") { Text(Self.date.string(from: date) ?? "—") }
      }
      if let date = display.expected_delivery_date {
        LabeledContent("Expected delivery") {
          Text(Self.date.string(from: date) ?? "—")
        }
      }
      if display.is_sample == true {
        LabeledContent("Type") {
          Label("Sample order", systemImage: "flask")
            .foregroundStyle(.teal)
        }
      }
      LabeledContent("Order ID") {
        Text(display.id).font(.footnote).monospaced()
          .textSelection(.enabled)
      }
    }
  }

  @ViewBuilder
  private var nextStepSection: some View {
    Section {
      switch nextStep {
      case .start:
        VStack(alignment: .leading, spacing: 8) {
          Text("Your next step").font(.body.weight(.semibold))
          Text("Confirm you can supply this order — it moves to Processing and the team is notified.")
            .font(.footnote).foregroundStyle(.secondary)
          Button {
            showStartConfirm = true
          } label: {
            if acting { ProgressView().frame(maxWidth: .infinity) }
            else { Text("Start this order").frame(maxWidth: .infinity) }
          }
          .buttonStyle(.borderedProminent)
          .disabled(acting)
        }
      case .recordDelivery:
        VStack(alignment: .leading, spacing: 8) {
          Text("Your next step").font(.body.weight(.semibold))
          Text("Record what you delivered — the quantities the team receives against stock, with the delivery date and tracking number.")
            .font(.footnote).foregroundStyle(.secondary)
          Button {
            showReceiptSheet = true
          } label: {
            Text("Record delivery").frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
        }
      case .none:
        EmptyView()
      }
    }
  }

  private func linesSection(_ lines: [InventoryOrderLine]) -> some View {
    Section("Goods") {
      ForEach(lines) { line in
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text(line.displayName)
              .font(.body.weight(.medium))
            Spacer()
            Text(Self.currency.string(line.price, code: display.currency_code ?? ""))
              .font(.footnote).foregroundStyle(.secondary)
          }
          HStack(spacing: 12) {
            Text("Ordered \(Self.quantities.string(from: NSNumber(value: line.quantity)) ?? "—")")
            if line.fulfilled > 0 {
              Text("Sent \(Self.quantities.string(from: NSNumber(value: line.fulfilled)) ?? "—")")
                .foregroundStyle(.teal)
            }
            if line.outstanding > 0 {
              Text("Outstanding \(Self.quantities.string(from: NSNumber(value: line.outstanding)) ?? "—")")
                .foregroundStyle(.orange)
            }
          }
          .font(.caption)
          .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
      }
    }
  }

  private func chargesSection(_ charges: InventoryOrderChargesResponse) -> some View {
    Section("Charges") {
      ForEach(charges.charges) { charge in
        LabeledContent(charge.type.capitalized) {
          Text(Self.currency.string(charge.amount, code: display.currency_code ?? ""))
            .foregroundStyle(
              (charge.direction ?? 0) >= 0 ? Color.primary : Color.green
            )
        }
      }
      if let goods = charges.goods_total {
        LabeledContent("Goods total") {
          Text(Self.currency.string(goods, code: display.currency_code ?? ""))
        }
      }
      if let ceiling = charges.payable_ceiling {
        LabeledContent("Payable up to") {
          Text(Self.currency.string(ceiling, code: display.currency_code ?? ""))
            .fontWeight(.semibold)
        }
      }
    }
  }

  @ViewBuilder
  private func partnerSection(_ info: InventoryOrderPartnerInfo) -> some View {
    if info.partner_status != nil
      || info.delivery_date != nil
      || info.tracking_number != nil {
      Section("Delivery") {
        if let status = info.partner_status {
          LabeledContent("Your progress") { Text(status.capitalized) }
        }
        if let date = info.delivery_date {
          LabeledContent("Delivery date") {
            Text(Self.date.string(from: date) ?? "—")
          }
        }
        if let tracking = info.tracking_number, !tracking.isEmpty {
          LabeledContent("Tracking") {
            Text(tracking).font(.footnote).monospaced()
              .textSelection(.enabled)
          }
        }
      }
    }
  }

  // MARK: - Actions

  @MainActor
  private func load() async {
    loading = detail == nil && listRow == nil
    errorText = nil
    do {
      let fetched = try await PartnerAPI.shared.inventoryOrder(id: orderID)
      withAnimation { detail = fetched }
      charges = try? await PartnerAPI.shared.inventoryOrderCharges(id: orderID)
    } catch {
      errorText = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't load this order."
    }
    loading = false
  }

  @MainActor
  private func start() async {
    acting = true
    defer { acting = false }
    do {
      try await PartnerAPI.shared.startInventoryOrder(id: orderID)
      NotificationCenter.default.post(name: .inventoryOrderDidMutate, object: nil)
      await load()
    } catch {
      actionError = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't start this order."
    }
  }

  static let currency: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "INR"
    return f
  }()

  static let quantities: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = 2
    return f
  }()

  static let date: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d, yyyy"
    return f
  }()
}

extension Notification.Name {
  /// Fired after a successful inventory-order mutation (start / receipt)
  /// so the list screen reloads.
  static let inventoryOrderDidMutate = Notification.Name("inventoryOrderDidMutate")
}

// MARK: - Receipt sheet

/// The goods receipt — per-line delivered quantities (prefilled with what's
/// outstanding), delivery date, tracking number and notes. This is the
/// payload the backend's complete route persists (#complete).
private struct DeliveryReceiptSheet: View {
  let order: PartnerInventoryOrder
  var onDone: () -> Void

  @Environment(\.dismiss) private var dismiss

  /// Per-line delivered quantity, keyed by line id, prefilled with the
  /// outstanding amount so the common case (delivering everything) is one
  /// tap. Lines the partner isn't sending yet are zeroed out — the backend
  /// only takes positive quantities, so zeros are omitted from the payload.
  @State private var quantities: [String: Double] = [:]
  @State private var deliveryDate = Date()
  @State private var trackingNumber = ""
  @State private var notes = ""
  @State private var sending = false
  @State private var sendError: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          if let lines = order.order_lines, !lines.isEmpty {
            ForEach(lines) { line in
              VStack(alignment: .leading, spacing: 4) {
                HStack {
                  Text(line.displayName).font(.body.weight(.medium))
                  Spacer()
                  Text("of \(InventoryOrderDetailView.quantities.string(from: NSNumber(value: line.quantity)) ?? "—")")
                    .font(.caption).foregroundStyle(.secondary)
                }
                HStack {
                  Button {
                    step(line, by: -1)
                  } label: { Image(systemName: "minus.circle.fill").font(.title3) }
                  .buttonStyle(.borderless)
                  .disabled((quantities[line.id] ?? 0) <= 0)

                  TextField(
                    "Delivered",
                    value: Binding(
                      get: { quantities[line.id] ?? 0 },
                      set: { quantities[line.id] = max(0, $0) }
                    ),
                    format: .number
                  )
                  .keyboardType(.decimalPad)
                  .multilineTextAlignment(.center)
                  .frame(maxWidth: 90)

                  Button {
                    step(line, by: 1)
                  } label: { Image(systemName: "plus.circle.fill").font(.title3) }
                  .buttonStyle(.borderless)

                  Spacer()
                  if line.fulfilled > 0 {
                    Text("already sent \(InventoryOrderDetailView.quantities.string(from: NSNumber(value: line.fulfilled)) ?? "—")")
                      .font(.caption2).foregroundStyle(.tertiary)
                  }
                }
              }
            }
          } else {
            Text("This order has no goods lines to record.")
              .foregroundStyle(.secondary)
          }
        } header: {
          Text("What are you delivering?")
        } footer: {
          Text("These are the quantities the team receives against stock. Leave a line at 0 to deliver it later.")
        }

        Section("Delivery details") {
          DatePicker("Delivery date", selection: $deliveryDate, displayedComponents: .date)
          TextField("Tracking number (optional)", text: $trackingNumber)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.characters)
        }

        Section("Notes") {
          TextField(
            "Anything the team should know (optional)",
            text: $notes,
            axis: .vertical
          )
          .lineLimit(2...4)
        }

        if let sendError {
          Section {
            Text(sendError).font(.footnote).foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Record delivery")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if sending {
            ProgressView()
          } else {
            Button("Submit") { Task { await submit() } }
              .fontWeight(.semibold)
          }
        }
      }
      .interactiveDismissDisabled(sending)
    }
    .onAppear { prefill() }
  }

  private func prefill() {
    guard quantities.isEmpty else { return }
    for line in order.order_lines ?? [] {
      // Common case first: everything still outstanding ships today.
      quantities[line.id] = line.outstanding
    }
  }

  private func step(_ line: InventoryOrderLine, by delta: Double) {
    let current = quantities[line.id] ?? 0
    let next = min(max(current + delta, 0), line.outstanding)
    quantities[line.id] = next
  }

  @MainActor
  private func submit() async {
    let lines = (order.order_lines ?? []).compactMap { line -> CompleteInventoryOrderBody.Line? in
      let quantity = quantities[line.id] ?? 0
      // Backend validator: quantity must be > 0 — zeros mean "not yet".
      guard quantity > 0 else { return nil }
      return CompleteInventoryOrderBody.Line(
        order_line_id: line.id, quantity: quantity)
    }

    guard !lines.isEmpty else {
      sendError = "Record at least one line's delivered quantity."
      return
    }

    sending = true
    sendError = nil
    defer { sending = false }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"

    do {
      try await PartnerAPI.shared.completeInventoryOrder(
        id: order.id,
        body: CompleteInventoryOrderBody(
          notes: notes.isEmpty ? nil : notes,
          deliveryDate: formatter.string(from: deliveryDate),
          trackingNumber: trackingNumber.isEmpty ? nil : trackingNumber,
          lines: lines
        )
      )
      NotificationCenter.default.post(name: .inventoryOrderDidMutate, object: nil)
      dismiss()
      onDone()
    } catch {
      sendError = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't record the delivery."
    }
  }
}
