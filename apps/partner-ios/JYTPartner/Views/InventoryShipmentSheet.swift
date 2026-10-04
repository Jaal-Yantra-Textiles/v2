import SwiftUI

/// Book a carrier shipment (AWB + label) for an inventory order — the
/// mobile counterpart of the partner-ui inventory-order-create-shipment
/// drawer. Weight and size are optional (the backend falls back to the
/// order's defaults); "Get rates" lets the partner pick the courier instead
/// of leaving it to the carrier. On success the AWB/tracking is shown here
/// and the order reloads.
struct CreateInventoryShipmentSheet: View {
  let orderID: String
  var onDone: () -> Void

  @Environment(\.dismiss) private var dismiss

  private enum Carrier: String, CaseIterable, Identifiable {
    case shiprocket
    case delhivery
    var id: String { rawValue }
    var label: String {
      switch self {
      case .shiprocket: return "Shiprocket"
      case .delhivery: return "Delhivery"
      }
    }
  }

  @State private var carrier: Carrier = .shiprocket
  @State private var weightKg = ""
  @State private var length = ""
  @State private var breadth = ""
  @State private var height = ""
  @State private var pickupDate = Self.tomorrow

  @State private var rates: [InventoryShippingRate]?
  @State private var selectedCourierID: String?
  @State private var fetchingRates = false
  @State private var ratesError: String?

  @State private var submitting = false
  @State private var submitError: String?
  @State private var created: CreatedInventoryShipment?

  var body: some View {
    NavigationStack {
      Group {
        if let created {
          successView(created)
        } else {
          form
        }
      }
      .navigationTitle("Create shipment")
      .navigationBarTitleDisplayMode(.inline)
      .interactiveDismissDisabled(submitting)
      .toolbar {
        if created != nil {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }.fontWeight(.semibold)
          }
        } else {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }.disabled(submitting)
          }
          ToolbarItem(placement: .confirmationAction) {
            if submitting {
              ProgressView()
            } else {
              Button("Create") { Task { await submit() } }
                .fontWeight(.semibold)
                .disabled(fetchingRates)
            }
          }
        }
      }
    }
  }

  // MARK: - Form

  private var form: some View {
    Form {
      Section {
        Picker("Carrier", selection: $carrier) {
          ForEach(Carrier.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .onChange(of: carrier) { _ in
          rates = nil
          selectedCourierID = nil
          ratesError = nil
        }
      } header: {
        Text("Carrier")
      } footer: {
        Text("Uses your registered pickup address. Weight and size are optional — leave them blank to use the order's defaults.")
      }

      Section("Package") {
        LabeledContent("Weight (kg)") { numberField("0.5", text: $weightKg) }
        LabeledContent("Length (cm)") { numberField("10", text: $length) }
        LabeledContent("Breadth (cm)") { numberField("10", text: $breadth) }
        LabeledContent("Height (cm)") { numberField("10", text: $height) }
      }

      Section {
        Button {
          Task { await fetchRates() }
        } label: {
          HStack {
            Label("Get rates", systemImage: "indianrupeesign.circle")
            Spacer()
            if fetchingRates { ProgressView() }
          }
        }
        .disabled(fetchingRates || submitting)

        if let rates {
          if rates.isEmpty {
            Text("No couriers available for this route.")
              .font(.footnote).foregroundStyle(.secondary)
          } else {
            ForEach(rates) { rate in
              rateRow(rate)
            }
          }
        }
        if let ratesError {
          Text(ratesError).font(.footnote).foregroundStyle(.red)
        }
      } header: {
        Text("Courier")
      } footer: {
        Text("Optional — get rates to choose a courier, or leave it for the carrier to assign.")
      }

      Section("Pickup") {
        DatePicker(
          "Pickup date",
          selection: $pickupDate,
          in: Calendar.current.startOfDay(for: Date())...,
          displayedComponents: .date
        )
      }

      if let submitError {
        Section {
          Label(submitError, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(.red)
        }
      }
    }
  }

  private func numberField(_ placeholder: String, text: Binding<String>) -> some View {
    TextField(placeholder, text: text)
      .keyboardType(.decimalPad)
      .multilineTextAlignment(.trailing)
      .frame(maxWidth: 110)
  }

  private func rateRow(_ rate: InventoryShippingRate) -> some View {
    let id = rate.courier_id?.value
    let selected = id != nil && id == selectedCourierID
    return Button {
      selectedCourierID = id
    } label: {
      HStack(alignment: .firstTextBaseline) {
        Image(systemName: selected ? "largecircle.fill.circle" : "circle")
          .foregroundStyle(selected ? Color.accentColor : Color.secondary)
        VStack(alignment: .leading, spacing: 2) {
          Text(rate.courier_name ?? "Courier")
            .foregroundStyle(.primary)
          HStack(spacing: 6) {
            if let days = rate.estimated_days, days > 0 {
              Text("\(CompletionSplit.format(days)) day\(days == 1 ? "" : "s")")
            }
            if rate.is_recommended == true {
              Text("Recommended").foregroundStyle(.teal)
            }
          }
          .font(.caption)
          .foregroundStyle(.secondary)
        }
        Spacer()
        Text(CompleteRunSheet.money(rate.amount, rate.currency_code?.uppercased() ?? "INR"))
          .foregroundStyle(.primary)
      }
    }
    .buttonStyle(.borderless)
    .disabled(id == nil)
  }

  // MARK: - Success

  private func successView(_ shipment: CreatedInventoryShipment) -> some View {
    List {
      Section {
        Label("Shipment created", systemImage: "checkmark.circle.fill")
          .foregroundStyle(.green)
          .font(.headline)
      }
      Section("Tracking") {
        if let awb = shipment.awb, !awb.isEmpty {
          LabeledContent("AWB") {
            Text(awb).monospaced().textSelection(.enabled)
          }
        }
        if let tracking = shipment.tracking_number, !tracking.isEmpty, tracking != shipment.awb {
          LabeledContent("Tracking number") {
            Text(tracking).monospaced().textSelection(.enabled)
          }
        }
        if let pickup = shipment.pickup?.scheduled_date, !pickup.isEmpty {
          LabeledContent("Pickup", value: pickup)
        }
        if let link = shipment.tracking_url.flatMap(URL.init(string:)) {
          Link("Track shipment", destination: link)
        }
        if let link = shipment.label_url.flatMap(URL.init(string:)) {
          Link("Open label", destination: link)
        }
      }
    }
  }

  // MARK: - Requests

  private func positive(_ text: String) -> Double? {
    let value = Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
    return (value ?? 0) > 0 ? value : nil
  }

  private var weightGrams: Int? {
    positive(weightKg).map { Int(($0 * 1000).rounded()) }
  }

  private var dimensions: InventoryShipmentDimensions? {
    let dims = InventoryShipmentDimensions(
      length: positive(length), breadth: positive(breadth), height: positive(height))
    return dims.isEmpty ? nil : dims
  }

  @MainActor
  private func fetchRates() async {
    fetchingRates = true
    ratesError = nil
    defer { fetchingRates = false }
    do {
      let response = try await PartnerAPI.shared.inventoryOrderShippingRates(
        id: orderID, carrier: carrier.rawValue,
        weightGrams: weightGrams, dimensions: dimensions)
      let sorted = response.rates.sorted { $0.amount < $1.amount }
      rates = sorted
      selectedCourierID = (sorted.first { $0.is_recommended == true } ?? sorted.first)?
        .courier_id?.value
    } catch {
      rates = nil
      selectedCourierID = nil
      ratesError = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't fetch courier rates."
    }
  }

  @MainActor
  private func submit() async {
    submitting = true
    submitError = nil
    defer { submitting = false }
    do {
      let shipment = try await PartnerAPI.shared.createInventoryOrderShipment(
        id: orderID,
        body: CreateInventoryShipmentBody(
          carrier: carrier.rawValue,
          weight_grams: weightGrams,
          dimensions_cm: dimensions,
          preferred_courier_id: selectedCourierID,
          pickup_date: Self.ymd.string(from: pickupDate)))
      created = shipment
      NotificationCenter.default.post(name: .inventoryOrderDidMutate, object: nil)
      onDone()
    } catch {
      // The backend's message as is — it names what to fix (no pickup
      // registered, no pincode, …).
      submitError = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't create the shipment."
    }
  }

  private static var tomorrow: Date {
    let today = Calendar.current.startOfDay(for: Date())
    return Calendar.current.date(byAdding: .day, value: 1, to: today) ?? today
  }

  private static let ymd: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.calendar = Calendar(identifier: .gregorian)
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()
}
