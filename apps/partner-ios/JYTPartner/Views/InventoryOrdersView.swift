import SwiftUI

/// The Inventory Orders screen — the mobile counterpart of the partner-ui's
/// `/inventory-orders` table: the raw-material purchases the partner is
/// commissioned for. Status filter, search, pagination, pull-to-refresh —
/// same skeleton as DesignOrdersView.
struct InventoryOrdersView: View {
  @State private var orders: [PartnerInventoryOrder] = []
  @State private var count = 0
  @State private var search = ""
  @State private var statusFilter: InventoryOrderStatus?
  @State private var loading = false
  @State private var errorText: String?
  @State private var nextPageOffset: Int?

  private let pageSize = 20

  var body: some View {
    NavigationStack {
      List {
        if let errorText, orders.isEmpty {
          ErrorView(message: errorText) {
            Task { await load(reset: true) }
          }
        } else if orders.isEmpty && !loading {
          EmptyView()
        } else {
          ForEach(orders) { order in
            NavigationLink(value: order) {
              InventoryOrderRow(order: order)
            }
          }
          if nextPageOffset != nil {
            HStack { Spacer(); ProgressView(); Spacer() }
              .listRowSeparator(.hidden)
              .task { await load(reset: false) }
          }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Inventory")
      .searchable(text: $search, prompt: "Search orders…")
      .onSubmit(of: .search) { Task { await load(reset: true) } }
      .onChange(of: search) { newValue in
        if newValue.isEmpty {
          Task { await load(reset: true) }
        }
      }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Picker("Status", selection: $statusFilter) {
              Text("All statuses").tag(InventoryOrderStatus?.none)
              ForEach(InventoryOrderStatus.allCases, id: \.self) { status in
                Text(status.rawValue).tag(InventoryOrderStatus?.some(status))
              }
            }
          } label: {
            Label(
              "Filter by status",
              systemImage: statusFilter == nil
                ? "line.3.horizontal.decrease.circle"
                : "line.3.horizontal.decrease.circle.fill"
            )
          }
        }
      }
      .onChange(of: statusFilter) { _ in
        Task { await load(reset: true) }
      }
      .refreshable { await load(reset: true) }
      .navigationDestination(for: PartnerInventoryOrder.self) { order in
        InventoryOrderDetailView(orderID: order.id, listRow: order)
      }
      .overlay {
        if loading && orders.isEmpty {
          ProgressView().controlSize(.large)
        }
      }
      .task { await load(reset: true) }
      .onReceive(NotificationCenter.default.publisher(for: .inventoryOrderDidMutate)) { _ in
        // A receipt/complete/start on the detail screen changes status and
        // line fulfillment — reload the list when it reports one.
        Task { await load(reset: true) }
      }
    }
  }

  @MainActor
  private func load(reset: Bool) async {
    if reset {
      loading = orders.isEmpty ? true : loading
      errorText = nil
    } else {
      loading = true
    }
    let offset = reset ? 0 : orders.count
    do {
      let page = try await PartnerAPI.shared.inventoryOrders(
        limit: pageSize,
        offset: offset,
        status: statusFilter?.rawValue,
        query: search.isEmpty ? nil : search
      )
      withAnimation {
        if reset {
          orders = page.inventory_orders
        } else {
          orders.append(contentsOf: page.inventory_orders)
        }
        count = page.count
        let next = page.offset + page.limit
        nextPageOffset = next < page.count ? next : nil
        loading = false
      }
    } catch {
      withAnimation {
        loading = false
        errorText = (error as? LocalizedError)?.errorDescription
          ?? "Couldn't load inventory orders."
      }
    }
  }
}

// MARK: - Row

private struct InventoryOrderRow: View {
  let order: PartnerInventoryOrder

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(order.id)
          .font(.body.weight(.semibold))
          .lineLimit(1)
          .monospaced()
        Spacer(minLength: 8)
        if let status = order.statusEnum {
          InventoryOrderStatusBadge(status: status)
        } else {
          Text(order.status)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color.blue.opacity(0.15), in: Capsule())
            .foregroundStyle(.blue)
        }
      }
      HStack(spacing: 16) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Goods").font(.caption2).foregroundStyle(.tertiary)
            .textCase(.uppercase)
          Text(Self.quantities.string(from: NSNumber(value: order.quantity ?? 0)) ?? "—")
            .font(.footnote.weight(.medium))
        }
        if let total = order.total_price {
          VStack(alignment: .leading, spacing: 2) {
            Text("Total").font(.caption2).foregroundStyle(.tertiary)
              .textCase(.uppercase)
            Text(Self.currency.string(total, code: order.currency_code ?? ""))
              .font(.footnote.weight(.medium))
          }
        }
        Spacer()
        if let created = order.created_at {
          VStack(alignment: .trailing, spacing: 2) {
            Text("Created").font(.caption2).foregroundStyle(.tertiary)
              .textCase(.uppercase)
            Text(Self.date.string(from: created) ?? "—")
              .font(.footnote.weight(.medium))
          }
        }
      }
      .padding(.top, 2)
      if let lines = order.order_lines, !lines.isEmpty {
        Text(lines.map(\.displayName).joined(separator: " · "))
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      if order.is_sample == true {
        Label("Sample order", systemImage: "flask")
          .font(.caption2.weight(.medium))
          .foregroundStyle(.teal)
      }
    }
    .padding(.vertical, 4)
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

/// Inventory-order status badge — the lifecycle vocabulary colored like the
/// run badges: action warm, shipped blue, terminal green, cancelled neutral.
struct InventoryOrderStatusBadge: View {
  let status: InventoryOrderStatus

  private var tint: Color {
    switch status {
    case .pending: return .indigo
    case .processing, .partial: return .orange
    case .readyForDelivery: return .teal
    case .shipped: return .blue
    case .delivered: return .green
    case .cancelled: return .gray
    }
  }

  var body: some View {
    Text(status.rawValue)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(tint.opacity(0.15), in: Capsule())
      .foregroundStyle(tint)
  }
}

private struct EmptyView: View {
  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "shippingbox")
        .font(.largeTitle)
        .foregroundStyle(.tertiary)
      Text("No inventory orders")
        .font(.headline)
      Text("Raw material you're commissioned to supply shows up here.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 40)
  }
}

private struct ErrorView: View {
  let message: String
  let retry: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "exclamationmark.triangle")
        .font(.largeTitle)
        .foregroundStyle(.red)
      Text("Couldn't load inventory orders")
        .font(.headline)
      Text(message)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("Retry", action: retry)
        .buttonStyle(.bordered)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 40)
  }
}
