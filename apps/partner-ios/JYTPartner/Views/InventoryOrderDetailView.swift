import PhotosUI
import SwiftUI

/// An inventory order — the raw material the partner is commissioned to
/// supply. Leads with the next steps (start / record the delivery / mark
/// ready / create a carrier shipment), lists the goods lines with fulfilled
/// vs outstanding, the booked shipments, and what charges make the order
/// payable. The receipt sheet is the mobile counterpart of
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
  @State private var showReadyConfirm = false
  @State private var showReceiptSheet = false
  @State private var showShipmentSheet = false
  // #2659 — per-line edits, kept on the phone until sent as one proposal.
  @State private var lineEdits: [String: EditableLine] = [:]
  @State private var addedItems: [EditableLine] = []
  @State private var removedStaged = false
  @State private var editsKey: String?
  @State private var editing: EditableLine?
  @State private var sendingEdits = false
  /// Photos already uploaded from this phone, so a retry after a failed send
  /// only uploads what is still missing (#2659 follow-up).
  @State private var uploadedPhotos: [String: String] = [:]

  private var editedCount: Int {
    lineEdits.values.filter(\.edited).count
      + addedItems.filter(\.edited).count
      + (removedStaged ? 1 : 0)
  }

  private var hasEdits: Bool { canProposeLines && editedCount > 0 }

  /// #1752 — a partner may propose line edits only before the goods ship.
  private var canProposeLines: Bool {
    display.statusEnum == .pending || display.statusEnum == .processing
  }

  private var display: PartnerInventoryOrder {
    detail ?? listRow
      ?? PartnerInventoryOrder(
        id: orderID, status: "", quantity: nil, total_price: nil,
        currency_code: nil, expected_delivery_date: nil, order_date: nil,
        is_sample: nil, order_lines: nil, partner_info: nil,
        created_at: nil, updated_at: nil)
  }

  /// What the partner can do next, by status (the backend's own gates):
  /// Pending → start; Processing → record delivery, ship; Partial → record
  /// the rest, mark ready, ship; Ready for Delivery / Shipped → ship.
  private enum NextStep: Hashable {
    case start
    case recordDelivery
    case readyForDelivery
    case createShipment
  }

  private var nextSteps: [NextStep] {
    switch display.statusEnum {
    case .pending: return [.start]
    case .processing: return [.recordDelivery, .createShipment]
    case .partial: return [.recordDelivery, .readyForDelivery, .createShipment]
    case .readyForDelivery, .shipped: return [.createShipment]
    default: return []
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
        if let shipments = detail?.shipments, !shipments.isEmpty {
          shipmentsSection(shipments)
        }
        if let info = display.partner_info {
          partnerSection(info)
        }
      }
    }
    .listStyle(.insetGrouped)
    // Pinned actions: they never scroll away, and the list insets its
    // content so nothing hides behind them.
    .safeAreaInset(edge: .bottom) {
      if !loading && (!nextSteps.isEmpty || hasEdits) {
        actionBar
      }
    }
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
    .confirmationDialog(
      "Mark ready for delivery?",
      isPresented: $showReadyConfirm,
      titleVisibility: .visible
    ) {
      Button("Mark ready") { Task { await markReady() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Confirm the goods are packed and ready to hand to the carrier.")
    }
    .sheet(isPresented: $showReceiptSheet) {
      DeliveryReceiptSheet(order: display) {
        Task { await load() }
      }
    }
    .sheet(isPresented: $showShipmentSheet) {
      CreateInventoryShipmentSheet(orderID: orderID) {
        Task { await load() }
      }
    }
    .sheet(item: $editing) { row in
      LineEditorSheet(
        row: row,
        canRemove: row.isNew && addedItems.contains { $0.id == row.id },
        onSave: saveEdit,
        onRemove: { removeAdded(row) }
      )
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
    let steps = nextSteps
    if !steps.isEmpty {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Text("Your next step").font(.body.weight(.semibold))
          // The buttons live in the bar pinned to the bottom.
          Text(nextStepHint(steps))
            .font(.footnote).foregroundStyle(.secondary)
        }
      }
    }
  }

  private func nextStepHint(_ steps: [NextStep]) -> String {
    switch steps.first {
    case .start:
      return "Confirm you can supply this order — it moves to Processing and the team is notified."
    case .recordDelivery:
      return display.statusEnum == .partial
        ? "Part of this order is recorded. Record the rest, mark it ready once packed, or book a carrier shipment."
        : "Record what you delivered — the quantities the team receives against stock — or book a carrier shipment."
    default:
      return "Book a carrier shipment (AWB + label) for these goods."
    }
  }

  @ViewBuilder
  private func nextStepButton(_ step: NextStep, primary: Bool) -> some View {
    let button = Button {
      switch step {
      case .start: showStartConfirm = true
      case .recordDelivery: showReceiptSheet = true
      case .readyForDelivery: showReadyConfirm = true
      case .createShipment: showShipmentSheet = true
      }
    } label: {
      Group {
        if acting && (step == .start || step == .readyForDelivery) {
          ProgressView()
        } else {
          switch step {
          case .start: Text("Start this order")
          case .recordDelivery: Text("Record delivery")
          case .readyForDelivery: Text("Mark ready for delivery")
          case .createShipment: Label("Create shipment", systemImage: "shippingbox")
          }
        }
      }
      .frame(maxWidth: .infinity)
    }
    .disabled(acting)
    if primary {
      button.buttonStyle(.borderedProminent)
    } else {
      button.buttonStyle(.bordered)
    }
  }

  private func shipmentsSection(_ shipments: [InventoryShipment]) -> some View {
    Section("Shipments") {
      ForEach(shipments) { shipment in
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text((shipment.carrier ?? "Carrier").capitalized)
              .font(.body.weight(.medium))
            Spacer()
            if let status = shipment.status {
              Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.caption).foregroundStyle(.secondary)
            }
          }
          if let awb = shipment.awb ?? shipment.tracking_number, !awb.isEmpty {
            Text("AWB \(awb)").font(.footnote).monospaced()
              .textSelection(.enabled)
          }
          if let pickup = shipment.pickup_scheduled_date, !pickup.isEmpty {
            Text("Pickup \(pickup)").font(.caption).foregroundStyle(.secondary)
          }
          HStack(spacing: 16) {
            if let link = shipment.tracking_url.flatMap(URL.init(string:)) {
              Link("Track", destination: link).font(.footnote)
            }
          }
          if shipment.status != "cancelled",
             !((shipment.awb ?? shipment.tracking_number) ?? "").isEmpty {
            InventoryShipmentActions(
              orderID: orderID,
              shipmentID: shipment.id,
              hasPickup: !(shipment.pickup_scheduled_date ?? "").isEmpty)
          }
        }
        .padding(.vertical, 2)
      }
    }
  }

  private func linesSection(_ lines: [InventoryOrderLine]) -> some View {
    Section {
      if canProposeLines {
        Text("Tap a material to change its quantity, price or photos.")
          .font(.caption).foregroundStyle(.secondary)
      }
      ForEach(lines) { line in
        lineRow(line)
      }
      ForEach(addedItems) { item in
        addedRow(item)
      }
      if let pending = display.pending_change, !hasEdits {
        let added = (pending.proposed_lines ?? []).filter { $0.id == nil && $0.remove != true }
        Label(
          added.isEmpty
            ? "Your changes are waiting for approval"
            : "Your changes (incl. \(added.count) new item\(added.count == 1 ? "" : "s")) are waiting for approval",
          systemImage: "clock"
        )
        .font(.footnote).foregroundStyle(.orange)
      }
    } header: {
      HStack {
        Text("Goods")
        Spacer()
        if canProposeLines {
          Menu {
            Button {
              editing = EditableLine(lineID: nil, title: "", quantity: "", price: "")
            } label: {
              Label("Add an item not on the order", systemImage: "plus")
            }
          } label: {
            Image(systemName: "ellipsis.circle").imageScale(.large)
          }
          .accessibilityLabel("Goods actions")
        }
      }
    }
  }

  @ViewBuilder
  private func lineRow(_ line: InventoryOrderLine) -> some View {
    let content = VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(line.displayName)
          .font(.body.weight(.medium))
        Spacer()
        Text(Self.currency.string(line.price, code: display.currency_code ?? ""))
          .font(.footnote).foregroundStyle(.secondary)
        if canProposeLines {
          Image(systemName: "pencil").foregroundStyle(.tint)
        }
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
      if let edit = lineEdits[line.id] {
        editSummary(edit)
      }
    }
    .padding(.vertical, 2)
    if canProposeLines, let edit = lineEdits[line.id] {
      Button { editing = edit } label: { content.contentShape(Rectangle()) }
        .buttonStyle(.plain)
    } else {
      content
    }
  }

  @ViewBuilder
  private func addedRow(_ item: EditableLine) -> some View {
    let content = VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text([item.name, item.color].filter { !$0.isEmpty }.joined(separator: " — "))
          .font(.body.weight(.medium))
        Spacer()
        Text("New item").font(.caption2.weight(.semibold))
          .padding(.horizontal, 6).padding(.vertical, 2)
          .background(Capsule().fill(Color.teal.opacity(0.15)))
        if canProposeLines {
          Image(systemName: "pencil").foregroundStyle(.tint)
        }
      }
      editSummary(item)
    }
    .padding(.vertical, 2)
    if canProposeLines {
      Button { editing = item } label: { content.contentShape(Rectangle()) }
        .buttonStyle(.plain)
    } else {
      content
    }
  }

  /// What this phone will send for a line, tagged as not yet applied.
  @ViewBuilder
  private func editSummary(_ row: EditableLine) -> some View {
    if row.edited || row.staged {
      let photos = row.photoURLs.count + row.newPhotos.count
      let what = row.remove
        ? "Taking off the order"
        : "\(row.quantity) × \(row.price)" + (photos > 0 ? " · \(photos) photo\(photos == 1 ? "" : "s")" : "")
      HStack(spacing: 6) {
        Text(what)
        Text(row.edited ? "Edited — not sent" : "Waiting for approval")
          .fontWeight(.semibold)
      }
      .font(.caption)
      .foregroundStyle(row.edited ? Color.orange : Color.indigo)
    }
  }

  private var actionBar: some View {
    VStack(spacing: 8) {
      if hasEdits {
        Button {
          Task { await sendEdits() }
        } label: {
          Group {
            if sendingEdits {
              ProgressView()
            } else {
              Text("Send changes for approval (\(editedCount))").fontWeight(.semibold)
            }
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .disabled(sendingEdits)
      }
      ForEach(Array(nextSteps.enumerated()), id: \.element) { index, step in
        nextStepButton(step, primary: index == 0 && !hasEdits)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(.bar)
  }

  // MARK: - Line edits (#2659)

  /// Rebuild the edit rows when the order changed on the server; keep them
  /// across a plain reload so unsent edits are not thrown away.
  private func resetEditsIfChanged(_ order: PartnerInventoryOrder) {
    let key = [
      order.updated_at.map { String($0.timeIntervalSince1970) } ?? "",
      order.pending_change?.id ?? "",
      order.pending_change?.submitted_at.map { String($0.timeIntervalSince1970) } ?? "",
    ].joined(separator: "|")
    guard key != editsKey else { return }
    editsKey = key
    let staged = order.pending_change?.proposed_lines ?? []
    let stagedByID = Dictionary(
      staged.compactMap { l in l.id.map { ($0, l) } },
      uniquingKeysWith: { a, _ in a }
    )
    var rows: [String: EditableLine] = [:]
    for line in order.order_lines ?? [] {
      let s = stagedByID[line.id]
      rows[line.id] = EditableLine(
        lineID: line.id,
        title: line.displayName,
        quantity: EditableLine.format(s?.quantity ?? line.quantity),
        price: EditableLine.format(s?.price ?? line.price),
        extraCost: s?.extra_cost ?? line.extra_cost,
        remove: s?.remove ?? false,
        photoURLs: s?.photos ?? [],
        staged: s != nil
      )
    }
    lineEdits = rows
    addedItems = staged.compactMap { l in
      guard l.id == nil, l.remove != true, let m = l.new_material else { return nil }
      return EditableLine(
        lineID: nil, title: "",
        quantity: EditableLine.format(l.quantity ?? 0),
        price: EditableLine.format(l.price ?? 0),
        name: m.name, color: m.color ?? "", composition: m.composition ?? "",
        unit: m.unit_of_measure ?? "Meter",
        photoURLs: l.photos ?? [],
        staged: true
      )
    }
    removedStaged = false
  }

  private func saveEdit(_ draft: EditableLine) {
    var row = draft
    row.edited = true
    if let id = row.lineID {
      lineEdits[id] = row
    } else if let index = addedItems.firstIndex(where: { $0.id == row.id }) {
      addedItems[index] = row
    } else {
      addedItems.append(row)
    }
    editing = nil
  }

  private func removeAdded(_ row: EditableLine) {
    if row.staged { removedStaged = true }
    addedItems.removeAll { $0.id == row.id }
    editing = nil
  }

  @MainActor
  private func sendEdits() async {
    let ordered = (display.order_lines ?? []).compactMap { lineEdits[$0.id] } + addedItems
    if let problem = EditableLine.problem(in: ordered) {
      actionError = problem
      return
    }
    sendingEdits = true
    defer { sendingEdits = false }
    do {
      var lines: [ProposeOrderLinesBody.Line] = []
      for row in ordered {
        if row.remove, let id = row.lineID {
          lines.append(.init(id: id, remove: true))
          continue
        }
        var photos = row.photoURLs
        // ONE photo per request, shrunk first. A whole row of camera photos in
        // one request went over Cloudflare's 100 MB body cap and came back as
        // a bare 403 before reaching the server.
        for photo in row.newPhotos {
          let key = "\(photo.filename)|\(photo.data.count)|\(photo.data.hashValue)"
          if let url = uploadedPhotos[key] {
            photos.append(url)
            continue
          }
          let part = PhotoShrinker.part(for: photo)
          do {
            let uploaded = try await PartnerAPI.shared.uploadPartnerFiles(parts: [part])
            if let url = uploaded.first?.url {
              uploadedPhotos[key] = url
              photos.append(url)
            }
          } catch PartnerError.http(let status, _) where status == 403 || status == 413 {
            actionError = "A photo for \(row.label) is too large to upload. Remove it, or take it again with the camera."
            return
          }
        }
        lines.append(.init(
          id: row.lineID,
          quantity: EditableLine.number(row.quantity),
          price: EditableLine.number(row.price),
          // Sent back as it was: the server writes null over an omitted one.
          extra_cost: row.extraCost,
          new_material: row.isNew
            ? ProposedNewMaterial(
                name: row.name.trimmingCharacters(in: .whitespaces),
                color: row.color.isEmpty ? nil : row.color,
                composition: row.composition.isEmpty ? nil : row.composition,
                unit_of_measure: row.unit.isEmpty ? nil : row.unit
              )
            : nil,
          photos: photos.isEmpty ? nil : photos
        ))
      }
      try await PartnerAPI.shared.proposeInventoryOrderLines(
        id: orderID, body: ProposeOrderLinesBody(order_lines: lines)
      )
      editsKey = nil
      NotificationCenter.default.post(name: .inventoryOrderDidMutate, object: nil)
      await load()
    } catch {
      actionError = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't send your changes."
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
      resetEditsIfChanged(fetched)
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

  /// Partial → Ready for Delivery (the backend refuses any other status).
  @MainActor
  private func markReady() async {
    acting = true
    defer { acting = false }
    do {
      try await PartnerAPI.shared.markInventoryOrderReadyForDelivery(id: orderID)
      NotificationCenter.default.post(name: .inventoryOrderDidMutate, object: nil)
      await load()
    } catch {
      actionError = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't mark this order ready."
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

        Section {
          TextField(
            isPartial
              ? "Why is this a partial delivery? (required)"
              : "Anything the team should know (optional)",
            text: $notes,
            axis: .vertical
          )
          .lineLimit(2...4)
        } header: {
          Text("Notes")
        } footer: {
          if isPartial {
            Text("You're delivering less than what's outstanding. Say why — the rest stays open on the order.")
              .foregroundStyle(.orange)
          }
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
              .disabled(isPartial && trimmedNotes.isEmpty)
          }
        }
      }
      .interactiveDismissDisabled(sending)
    }
    .onAppear { prefill() }
  }

  /// Less than everything outstanding is going out — a partial delivery,
  /// which needs a note saying why.
  private var isPartial: Bool {
    (order.order_lines ?? []).contains { line in
      line.outstanding > 0 && (quantities[line.id] ?? 0) < line.outstanding
    }
  }

  private var trimmedNotes: String {
    notes.trimmingCharacters(in: .whitespacesAndNewlines)
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
    guard !isPartial || !trimmedNotes.isEmpty else {
      sendError = "This is a partial delivery — add a note saying why."
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
          notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
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

// MARK: - Line edits (#1752, #2659)

/// One line's edit — an existing line (`lineID`) or a new item. Photos are
/// uploaded (`photoURLs`) or freshly picked (`newPhotos`, uploaded on send).
struct EditableLine: Identifiable {
  var id = UUID()
  var lineID: String?
  var title: String
  var quantity: String
  var price: String
  var extraCost: Double?
  var remove = false
  var name = ""
  var color = ""
  var composition = ""
  var unit = "Meter"
  var photoURLs: [String] = []
  var newPhotos: [MediaFilePick] = []
  /// From the pending proposal — "waiting for approval".
  var staged = false
  /// Changed on this phone and not sent yet.
  var edited = false

  var isNew: Bool { lineID == nil }
  var label: String { isNew ? (name.isEmpty ? "New item" : name) : title }

  static func format(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(value)
  }

  static func number(_ text: String) -> Double? {
    Double(text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces))
  }

  /// The first problem the server would refuse, in plain words.
  static func problem(in rows: [EditableLine]) -> String? {
    for row in rows where !row.remove {
      if row.isNew && row.name.trimmingCharacters(in: .whitespaces).isEmpty {
        return "Every new item needs a name."
      }
      guard let qty = number(row.quantity), qty > 0 else {
        return "Quantity must be more than 0 for \(row.label). To drop a line, switch on \"Take off the order\"."
      }
      guard let price = number(row.price), price >= 0 else {
        return "Enter a price (0 or more) for \(row.label)."
      }
    }
    return nil
  }
}

/// Edit ONE line (or a new item). Saved on the phone; sent from the bar.
struct LineEditorSheet: View {
  let row: EditableLine
  let canRemove: Bool
  let onSave: (EditableLine) -> Void
  let onRemove: () -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var draft: EditableLine
  @State private var error: String?
  @State private var pickerItems: [PhotosPickerItem] = []
  @State private var showPicker = false
  @State private var showCamera = false

  init(row: EditableLine, canRemove: Bool, onSave: @escaping (EditableLine) -> Void, onRemove: @escaping () -> Void) {
    self.row = row
    self.canRemove = canRemove
    self.onSave = onSave
    self.onRemove = onRemove
    _draft = State(initialValue: row)
  }

  var body: some View {
    NavigationStack {
      withPickers(
        form
          .navigationTitle(draft.isNew ? "Item not on the order" : draft.title)
          .navigationBarTitleDisplayMode(.inline)
          .toolbar { toolbarContent }
      )
    }
  }

  private var form: some View {
    Form {
      if draft.isNew {
        Section("Item") {
          TextField("Name (e.g. Matty Cotton)", text: $draft.name)
          TextField("Colour", text: $draft.color)
          TextField("Composition (optional)", text: $draft.composition)
          TextField("Unit", text: $draft.unit)
        }
      }
      if !draft.remove {
        Section("What you have") {
          numberField("Quantity", text: $draft.quantity)
          numberField("Price per unit", text: $draft.price)
        }
        Section("Photos") {
          photoStrip
          HStack {
            Button { showPicker = true } label: { Label("Gallery", systemImage: "photo.on.rectangle") }
              .buttonStyle(.bordered)
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
              Button { showCamera = true } label: { Label("Camera", systemImage: "camera") }
                .buttonStyle(.bordered)
            }
          }
        }
      }
      if !draft.isNew {
        Section {
          Toggle("Take off the order", isOn: $draft.remove)
        }
      }
      if canRemove {
        Section {
          Button("Remove this item", role: .destructive) { onRemove() }
        }
      }
      if let error {
        Section { Text(error).foregroundStyle(.red).font(.footnote) }
      }
      Section {
        Text("Saved on your phone. Tap \"Send changes for approval\" to send them.")
          .font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  @ToolbarContentBuilder
  private var toolbarContent: some ToolbarContent {
    ToolbarItem(placement: .cancellationAction) {
      Button("Cancel") { dismiss() }
    }
    ToolbarItem(placement: .confirmationAction) {
      Button("Save") { save() }
    }
  }

  @ViewBuilder
  private var photoStrip: some View {
    if !draft.photoURLs.isEmpty || !draft.newPhotos.isEmpty {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(draft.photoURLs, id: \.self) { url in
            AsyncImage(url: URL(string: url)) { image in
              image.resizable().scaledToFill()
            } placeholder: { Color.gray.opacity(0.2) }
            .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 6))
          }
          ForEach(Array(draft.newPhotos.enumerated()), id: \.offset) { _, pick in
            if let image = UIImage(data: pick.data) {
              Image(uiImage: image).resizable().scaledToFill()
                .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 6))
            }
          }
        }
      }
    }
  }

  private func numberField(_ label: String, text: Binding<String>) -> some View {
    HStack {
      Text(label)
      Spacer()
      TextField("0", text: text)
        .keyboardType(.decimalPad)
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: 120)
    }
  }

  private func withPickers<V: View>(_ content: V) -> some View {
    content
      .photosPicker(isPresented: $showPicker, selection: $pickerItems, maxSelectionCount: 6, matching: .images)
      .onChange(of: pickerItems) { items in addPicked(items) }
      .fullScreenCover(isPresented: $showCamera) {
        CameraPicker { pick in draft.newPhotos.append(pick) }
          .ignoresSafeArea()
      }
  }

  private func addPicked(_ items: [PhotosPickerItem]) {
    guard !items.isEmpty else { return }
    Task { @MainActor in
      for item in items {
        if let pick = await MediaLoader.load(item) { draft.newPhotos.append(pick) }
      }
      pickerItems = []
    }
  }

  private func save() {
    if draft.isNew && draft.name.trimmingCharacters(in: .whitespaces).isEmpty {
      error = "Give the item a name."
      return
    }
    if !draft.remove {
      guard let qty = EditableLine.number(draft.quantity), qty > 0 else {
        error = "Quantity must be more than 0. To drop the line, switch on \"Take off the order\"."
        return
      }
      guard let price = EditableLine.number(draft.price), price >= 0 else {
        error = "Enter a price (0 or more)."
        return
      }
      _ = (qty, price)
    }
    onSave(draft)
  }
}
