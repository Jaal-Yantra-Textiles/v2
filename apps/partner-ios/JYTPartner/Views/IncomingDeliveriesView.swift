import SwiftUI

// #2286 — goods delivered TO this partner's warehouse, whoever supplies
// them: the receiving side of inventory orders. Mirrors the Android
// IncomingDeliveriesScreen / IncomingDeliveryDetailScreen. Deliberately no
// prices — each line shows what was ordered, received and still owed.

extension Notification.Name {
  /// Fired after a receipt is confirmed so the list reloads.
  static let incomingDeliveryDidMutate = Notification.Name("incomingDeliveryDidMutate")
}

private let quantityFormat: NumberFormatter = {
  let f = NumberFormatter()
  f.numberStyle = .decimal
  f.maximumFractionDigits = 3
  return f
}()

private func formatQuantity(_ value: Double) -> String {
  quantityFormat.string(from: NSNumber(value: value)) ?? "—"
}

private let dayFormat: DateFormatter = {
  let f = DateFormatter()
  f.dateFormat = "MMM d, yyyy"
  return f
}()

// MARK: - List

struct IncomingDeliveriesView: View {
  @State private var deliveries: [IncomingDelivery] = []
  @State private var locationID: String?
  @State private var includeAll = false
  @State private var loading = true
  @State private var errorText: String?

  var body: some View {
    List {
      if let errorText, deliveries.isEmpty {
        Section {
          VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
              .font(.largeTitle).foregroundStyle(.red)
            Text("Couldn't load deliveries").font(.headline)
            Text(errorText).font(.subheadline)
              .foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Retry") { Task { await load() } }
              .buttonStyle(.bordered)
          }
          .frame(maxWidth: .infinity).padding(.vertical, 24)
        }
      } else if !loading && locationID == nil {
        Section {
          emptyState(
            title: "No warehouse is set up",
            subtitle: "Contact the JYT team to link your warehouse — goods delivered to you will show up here.")
        }
      } else if !loading || !deliveries.isEmpty {
        Section {
          Toggle("Include fully received", isOn: $includeAll)
            .font(.footnote)
        }
        if deliveries.isEmpty {
          Section {
            emptyState(
              title: includeAll ? "No deliveries" : "Nothing outstanding",
              subtitle: "Goods sent to your warehouse show up here.")
          }
        } else {
          Section {
            ForEach(deliveries) { delivery in
              NavigationLink {
                IncomingDeliveryDetailView(deliveryID: delivery.id, initial: delivery)
              } label: {
                IncomingDeliveryRow(delivery: delivery)
              }
            }
          }
        }
      }
    }
    .listStyle(.insetGrouped)
    .navigationTitle("Incoming deliveries")
    .overlay {
      if loading && deliveries.isEmpty && errorText == nil {
        ProgressView().controlSize(.large)
      }
    }
    .refreshable { await load() }
    .task { await load() }
    .onChange(of: includeAll) { _ in Task { await load() } }
    .onReceive(NotificationCenter.default.publisher(for: .incomingDeliveryDidMutate)) { _ in
      Task { await load() }
    }
  }

  private func emptyState(title: String, subtitle: String) -> some View {
    VStack(spacing: 8) {
      Image(systemName: "shippingbox")
        .font(.largeTitle).foregroundStyle(.secondary)
      Text(title).font(.headline)
      Text(subtitle).font(.subheadline)
        .foregroundStyle(.secondary).multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity).padding(.vertical, 24)
  }

  @MainActor
  private func load() async {
    loading = deliveries.isEmpty
    do {
      let response = try await PartnerAPI.shared.incomingDeliveries(all: includeAll)
      deliveries = response.incoming_deliveries
      locationID = response.location_id
      errorText = nil
    } catch {
      errorText = (error as? LocalizedError)?.errorDescription
        ?? "Something went wrong."
    }
    loading = false
  }
}

private struct IncomingDeliveryRow: View {
  let delivery: IncomingDelivery

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(delivery.from ?? "Order")
          .font(.body.weight(.semibold))
          .lineLimit(1)
        Spacer(minLength: 8)
        if let status = delivery.statusEnum {
          InventoryOrderStatusBadge(status: status)
        }
      }
      HStack(spacing: 16) {
        Text("Outstanding \(formatQuantity(delivery.outstanding))")
        if let date = delivery.expected_delivery_date {
          Text("Expected \(dayFormat.string(from: date))")
        }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      if !delivery.lines.isEmpty {
        Text(delivery.lines.map { $0.name ?? "Material" }.joined(separator: " · "))
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      if delivery.is_sample == true {
        Text("Sample order").font(.caption.weight(.medium)).foregroundStyle(.teal)
      }
    }
    .padding(.vertical, 2)
  }
}

// MARK: - Detail

/// One incoming delivery. Loads from the list read with all=true (there is
/// no single-delivery route) so a fully received order still opens.
struct IncomingDeliveryDetailView: View {
  let deliveryID: String
  var initial: IncomingDelivery?

  @State private var delivery: IncomingDelivery?
  @State private var loading = false
  @State private var errorText: String?
  @State private var showReceive = false

  private var current: IncomingDelivery? { delivery ?? initial }

  var body: some View {
    List {
      if let current {
        overview(current)
        if current.outstanding > 0 {
          Section("Still owed") {
            Text("\(formatQuantity(current.outstanding)) of goods outstanding across \(current.lines.count) line(s).")
              .font(.footnote).foregroundStyle(.secondary)
          }
        }
        if !current.lines.isEmpty {
          goods(current.lines)
        }
        if current.can_confirm == true {
          Section {
            Button {
              showReceive = true
            } label: {
              Label("Confirm received", systemImage: "checkmark.circle")
                .frame(maxWidth: .infinity)
                .font(.body.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
          } footer: {
            Text("State what actually arrived — it's received against your stock.")
          }
        } else {
          Section {
            Label(
              current.cannot_confirm_reason == "not_dispatched"
                ? "This order hasn't been dispatched yet. You can confirm once it ships."
                : "Fully received — nothing further is needed.",
              systemImage: current.cannot_confirm_reason == "not_dispatched"
                ? "shippingbox" : "checkmark.circle.fill")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
      } else if loading {
        Section { HStack { Spacer(); ProgressView(); Spacer() } }
      } else {
        Section {
          VStack(spacing: 10) {
            Text("Couldn't load this delivery").font(.headline)
            if let errorText {
              Text(errorText).font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            }
            Button("Retry") { Task { await load() } }.buttonStyle(.bordered)
          }
          .frame(maxWidth: .infinity).padding(.vertical, 24)
        }
      }
    }
    .listStyle(.insetGrouped)
    .navigationTitle("Incoming delivery")
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await load() }
    .task { if initial == nil { await load() } }
    .sheet(isPresented: $showReceive) {
      if let current {
        ReceiveIncomingSheet(delivery: current) {
          Task { await load() }
        }
      }
    }
  }

  private func overview(_ d: IncomingDelivery) -> some View {
    Section("Overview") {
      LabeledContent("Status") {
        if let status = d.statusEnum {
          InventoryOrderStatusBadge(status: status)
        } else {
          Text(d.status)
        }
      }
      if let from = d.from { LabeledContent("From", value: from) }
      if let date = d.expected_delivery_date {
        LabeledContent("Expected delivery", value: dayFormat.string(from: date))
      }
      if let date = d.order_date {
        LabeledContent("Ordered", value: dayFormat.string(from: date))
      }
      if let invoice = d.invoice_number?.value, !invoice.isEmpty {
        LabeledContent("Invoice", value: invoice)
      }
      if d.is_sample == true { LabeledContent("Type", value: "Sample order") }
      LabeledContent("Delivery ID") {
        Text(d.id).font(.footnote).monospaced().textSelection(.enabled)
      }
    }
  }

  private func goods(_ lines: [IncomingDeliveryLine]) -> some View {
    Section("Goods") {
      ForEach(lines) { line in
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text(line.name ?? "Material").font(.body.weight(.medium))
            Spacer()
            Text("\(formatQuantity(line.ordered)) \(line.unit ?? "")".trimmingCharacters(in: .whitespaces))
              .font(.caption).foregroundStyle(.secondary)
          }
          Text(line.outstanding > 0
               ? "Received \(formatQuantity(line.received)) · Outstanding \(formatQuantity(line.outstanding))"
               : "Received \(formatQuantity(line.received)) · Fully received")
            .font(.caption)
            .foregroundStyle(line.outstanding > 0 ? Color.orange : Color.secondary)
        }
        .padding(.vertical, 2)
      }
    }
  }

  @MainActor
  private func load() async {
    loading = current == nil
    defer { loading = false }
    do {
      let response = try await PartnerAPI.shared.incomingDeliveries(all: true)
      if let found = response.incoming_deliveries.first(where: { $0.id == deliveryID }) {
        delivery = found
        errorText = nil
      } else {
        errorText = "This delivery is no longer listed for your warehouse."
      }
    } catch {
      errorText = (error as? LocalizedError)?.errorDescription
        ?? "Something went wrong."
    }
  }
}

// MARK: - Confirm receipt

/// What actually arrived, per line — prefilled with what's outstanding; 0
/// is allowed for a line that brought nothing. A note is REQUIRED when
/// something is short: the receipt is recorded with the shortfall and why.
private struct ReceiveIncomingSheet: View {
  let delivery: IncomingDelivery
  var onDone: () -> Void

  @Environment(\.dismiss) private var dismiss

  @State private var quantities: [String: Double] = [:]
  @State private var notes = ""
  @State private var sending = false
  @State private var sendError: String?

  private func received(_ line: IncomingDeliveryLine) -> Double {
    min(max(quantities[line.id] ?? 0, 0), line.outstanding)
  }

  private var isShort: Bool {
    delivery.lines.reduce(0) { $0 + received($1) }
      < delivery.lines.reduce(0) { $0 + $1.outstanding }
  }

  private var anyPositive: Bool { delivery.lines.contains { received($0) > 0 } }

  private var trimmedNotes: String { notes.trimmingCharacters(in: .whitespacesAndNewlines) }

  private var canSubmit: Bool {
    !sending && anyPositive && (!isShort || !trimmedNotes.isEmpty)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          ForEach(delivery.lines) { line in
            VStack(alignment: .leading, spacing: 4) {
              HStack {
                Text(line.name ?? "Material").font(.body.weight(.medium))
                Spacer()
                Text("of \(formatQuantity(line.ordered))")
                  .font(.caption).foregroundStyle(.secondary)
              }
              HStack {
                Button { step(line, by: -1) } label: {
                  Image(systemName: "minus.circle.fill").font(.title3)
                }
                .buttonStyle(.borderless)
                .disabled(received(line) <= 0)

                TextField(
                  "Received",
                  value: Binding(
                    get: { quantities[line.id] ?? 0 },
                    set: { quantities[line.id] = min(max(0, $0), line.outstanding) }
                  ),
                  format: .number
                )
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 90)

                Button { step(line, by: 1) } label: {
                  Image(systemName: "plus.circle.fill").font(.title3)
                }
                .buttonStyle(.borderless)
                .disabled(received(line) >= line.outstanding)

                Spacer()
                Text("owed \(formatQuantity(line.outstanding))")
                  .font(.caption2).foregroundStyle(.tertiary)
              }
            }
          }
        } header: {
          Text("What arrived?")
        } footer: {
          Text("The team receives this against your stock. Leave a line at 0 if it brought nothing.")
        }

        Section {
          TextField(
            isShort ? "Why the shortfall? (required)" : "Notes (optional)",
            text: $notes,
            axis: .vertical
          )
          .lineLimit(2...4)
        } header: {
          Text("Notes")
        } footer: {
          if isShort {
            Text("Something is short — explain why. The shortfall stays outstanding on the order.")
              .foregroundStyle(.orange)
          }
        }

        if let sendError {
          Section {
            Text(sendError).font(.footnote).foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Confirm receipt")
      .navigationBarTitleDisplayMode(.inline)
      .interactiveDismissDisabled(sending)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(sending)
        }
        ToolbarItem(placement: .confirmationAction) {
          if sending {
            ProgressView()
          } else {
            Button("Confirm") { Task { await submit() } }
              .fontWeight(.semibold)
              .disabled(!canSubmit)
          }
        }
      }
    }
    .onAppear {
      guard quantities.isEmpty else { return }
      for line in delivery.lines { quantities[line.id] = line.outstanding }
    }
  }

  private func step(_ line: IncomingDeliveryLine, by delta: Double) {
    quantities[line.id] = min(max(received(line) + delta, 0), line.outstanding)
  }

  @MainActor
  private func submit() async {
    guard canSubmit else { return }
    sending = true
    sendError = nil
    defer { sending = false }
    do {
      try await PartnerAPI.shared.receiveIncomingDelivery(
        orderId: delivery.id,
        body: ReceiveIncomingBody(
          lines: delivery.lines.map {
            ReceiveIncomingBody.Line(order_line_id: $0.id, quantity: received($0))
          },
          notes: trimmedNotes.isEmpty ? nil : trimmedNotes))
      NotificationCenter.default.post(name: .incomingDeliveryDidMutate, object: nil)
      dismiss()
      onDone()
    } catch {
      sendError = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't record the receipt."
    }
  }
}
