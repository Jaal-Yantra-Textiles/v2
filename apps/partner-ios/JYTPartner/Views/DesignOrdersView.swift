import SwiftUI

/// The Design Orders screen — the mobile counterpart of the partner-ui's
/// `/orders/design` table: design picture + name lead, then order #, total,
/// date, and the Work-status badge. Paginates 20 rows at a time like the
/// web table, with pull-to-refresh and search.
struct DesignOrdersView: View {
  @State private var orders: [PartnerOrder] = []
  @State private var count = 0
  @State private var search = ""
  @State private var loading = false
  @State private var errorText: String?
  @State private var nextPageOffset: Int?

  private let pageSize = 20

  var body: some View {
    NavigationStack {
      List {
        if let errorText, orders.isEmpty {
          ContentErrorView(message: errorText) {
            Task { await load(reset: true) }
          }
        } else if orders.isEmpty && !loading {
          ContentEmptyView()
        } else {
          ForEach(orders) { order in
            NavigationLink(value: order) {
              DesignOrderRow(order: order)
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
      .navigationTitle("Orders")
      .searchable(text: $search, prompt: "Search orders…")
      .onSubmit(of: .search) { Task { await load(reset: true) } }
      .onChange(of: search) { newValue in
        // Clearing the field should also clear the active search.
        if newValue.isEmpty {
          Task { await load(reset: true) }
        }
      }
      .refreshable { await load(reset: true) }
      .navigationDestination(for: PartnerOrder.self) { order in
        // The row carries the list-only fields (designs, currency) the
        // detail read doesn't — pass it in as the display fallback.
        OrderDetailView(orderID: order.id, listRow: order)
      }
      .overlay {
        if loading && orders.isEmpty {
          ProgressView().controlSize(.large)
        }
      }
      .task { await load(reset: true) }
      .onReceive(NotificationCenter.default.publisher(for: .runDidMutate)) { _ in
        // A run mutation (accept/start/finish/complete) changes work status
        // and order rows — reload when the run screen reports one.
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
      let page = try await PartnerAPI.shared.orders(
        kind: "design",
        limit: pageSize,
        offset: offset,
        query: search.isEmpty ? nil : search
      )
      withAnimation {
        if reset {
          orders = page.orders
        } else {
          orders.append(contentsOf: page.orders)
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
          ?? "Couldn't load design orders."
      }
    }
  }
}

// MARK: - Row

private struct DesignOrderRow: View {
  let order: PartnerOrder

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      DesignThumb(name: first?.name, thumbnail: first?.thumbnail)
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text(first?.name ?? "Design order")
            .font(.body.weight(.semibold))
            .lineLimit(1)
          Spacer(minLength: 8)
          if let status = order.workStatus {
            WorkStatusBadge(status: status)
          }
        }
        if let extra = extraCount, extra > 0 {
          Text("+\(extra) more design\(extra > 1 ? "s" : "")")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 16) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Order").font(.caption2).foregroundStyle(.tertiary)
              .textCase(.uppercase)
            Text("#\(order.display_id)").font(.footnote.weight(.medium))
          }
          VStack(alignment: .leading, spacing: 2) {
            Text("Total").font(.caption2).foregroundStyle(.tertiary)
              .textCase(.uppercase)
            Text(Self.currency.string(order.total, code: order.currency_code ?? ""))
              .font(.footnote.weight(.medium))
          }
          Spacer()
          VStack(alignment: .trailing, spacing: 2) {
            Text("Created").font(.caption2).foregroundStyle(.tertiary)
              .textCase(.uppercase)
            Text(Self.date.string(from: order.created_at) ?? "—")
              .font(.footnote.weight(.medium))
          }
        }
        .padding(.top, 2)
      }
    }
    .padding(.vertical, 4)
  }

  private var first: OrderDesignSummary? { order.designs?.first }
  private var extraCount: Int? {
    guard let designs = order.designs, designs.count > 1 else { return nil }
    return designs.count - 1
  }

  static let currency: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "INR"
    return f
  }()

  static let date: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d, yyyy"
    return f
  }()
}

private struct ContentEmptyView: View {
  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "shirt")
        .font(.largeTitle)
        .foregroundStyle(.tertiary)
      Text("No design orders")
        .font(.headline)
      Text("Work you're commissioned for will show up here.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 40)
  }
}

private struct ContentErrorView: View {
  let message: String
  let retry: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "exclamationmark.triangle")
        .font(.largeTitle)
        .foregroundStyle(.red)
      Text("Couldn't load design orders")
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
