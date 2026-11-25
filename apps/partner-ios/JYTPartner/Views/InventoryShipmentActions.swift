import SwiftUI

/// Pickup slots offered; Delhivery needs a time, mid-afternoon is the default.
let inventoryPickupTimes = ["10:00", "12:00", "14:00", "16:00"]

/// Label + pickup for one carrier shipment. "Download label" fetches a fresh
/// link on each tap (Delhivery's PDF expires after 24 hours) and opens it.
/// "Book pickup" is offered while no pickup is booked; the carrier's refusal
/// is shown as is.
struct InventoryShipmentActions: View {
  let orderID: String
  let shipmentID: String
  let hasPickup: Bool
  var onPickupBooked: () -> Void = {}

  @Environment(\.openURL) private var openURL
  @State private var labelLoading = false
  @State private var showForm = false
  @State private var booked = false
  @State private var booking = false
  @State private var date = Calendar.current.date(
    byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())) ?? Date()
  @State private var time = "14:00"
  @State private var message: String?
  @State private var isError = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        Button {
          Task { await openLabel() }
        } label: {
          if labelLoading { ProgressView() } else { Text("Download label") }
        }
        .buttonStyle(.bordered)
        .disabled(labelLoading)

        if !(hasPickup || booked) && !showForm {
          Button("Book pickup") { showForm = true }
            .buttonStyle(.bordered)
        }
      }

      if showForm && !(hasPickup || booked) {
        DatePicker("Pickup date", selection: $date,
                   in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
        Picker("Pickup time", selection: $time) {
          ForEach(inventoryPickupTimes, id: \.self) { Text($0).tag($0) }
        }
        .pickerStyle(.segmented)
        Button {
          Task { await book() }
        } label: {
          if booking { ProgressView() } else { Text("Book pickup").frame(maxWidth: .infinity) }
        }
        .buttonStyle(.borderedProminent)
        .disabled(booking)
      }

      if let message {
        Text(message)
          .font(.caption)
          .foregroundStyle(isError ? Color.red : Color.secondary)
      }
    }
    .buttonStyle(.borderless)
  }

  @MainActor
  private func openLabel() async {
    labelLoading = true
    message = nil
    defer { labelLoading = false }
    do {
      let label = try await PartnerAPI.shared.inventoryShipmentLabel(orderID: orderID, shipmentID: shipmentID)
      if let url = label.label_url.flatMap(URL.init(string:)) {
        openURL(url)
      } else {
        isError = true
        message = "The label isn't ready yet. Try again in a minute."
      }
    } catch {
      isError = true
      message = (error as? LocalizedError)?.errorDescription ?? "Couldn't get the label."
    }
  }

  @MainActor
  private func book() async {
    booking = true
    message = nil
    defer { booking = false }
    do {
      let result = try await PartnerAPI.shared.bookInventoryShipmentPickup(
        orderID: orderID, shipmentID: shipmentID,
        body: BookInventoryPickupBody(pickup_date: Self.ymd.string(from: date), pickup_time: time))
      if result.scheduled {
        booked = true
        isError = false
        message = "Pickup booked for \(result.pickup_date ?? "") at \(result.pickup_time ?? time)."
        NotificationCenter.default.post(name: .inventoryOrderDidMutate, object: nil)
        onPickupBooked()
      } else {
        isError = true
        message = "Pickup not booked: \(result.reason ?? "the carrier refused it.")"
      }
    } catch {
      isError = true
      message = (error as? LocalizedError)?.errorDescription ?? "Couldn't book the pickup."
    }
  }

  private static let ymd: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.calendar = Calendar(identifier: .gregorian)
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()
}
