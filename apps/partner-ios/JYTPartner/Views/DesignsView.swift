import SwiftUI

/// The Designs tab (#2402) — every design this partner can see (linked to
/// them or their own), newest first: picture, name, status. Tapping one
/// opens the design manager. Search runs server-side (`q` on
/// GET /partners/designs, matched over the whole partner-scoped set), and
/// the list pages 20 at a time like the Orders tab.
struct DesignsView: View {
  @State private var designs: [PartnerDesignRow] = []
  @State private var search = ""
  @State private var loading = false
  @State private var errorText: String?
  @State private var nextPageOffset: Int?

  private let pageSize = 20

  var body: some View {
    NavigationStack {
      List {
        if let errorText, designs.isEmpty {
          ContentErrorView(message: errorText) {
            Task { await load(reset: true) }
          }
        } else if designs.isEmpty && !loading {
          ContentEmptyView(searching: !search.isEmpty)
        } else {
          ForEach(designs) { design in
            NavigationLink(value: design) {
              DesignRow(design: design)
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
      .navigationTitle("Designs")
      .searchable(text: $search, prompt: "Search designs…")
      .onSubmit(of: .search) { Task { await load(reset: true) } }
      .onChange(of: search) { newValue in
        // Clearing the field should also clear the active search.
        if newValue.isEmpty {
          Task { await load(reset: true) }
        }
      }
      .refreshable { await load(reset: true) }
      .navigationDestination(for: PartnerDesignRow.self) { design in
        DesignDetailView(designID: design.id, fallbackRow: design)
      }
      .overlay {
        if loading && designs.isEmpty {
          ProgressView().controlSize(.large)
        }
      }
      .task { await load(reset: true) }
      .onReceive(NotificationCenter.default.publisher(for: .runDidMutate)) { _ in
        // A run mutation changes the partner status shown on each row.
        Task { await load(reset: true) }
      }
    }
  }

  @MainActor
  private func load(reset: Bool) async {
    if reset {
      loading = designs.isEmpty ? true : loading
      errorText = nil
    } else {
      loading = true
    }
    let offset = reset ? 0 : designs.count
    do {
      let page = try await PartnerAPI.shared.designs(
        limit: pageSize,
        offset: offset,
        query: search.isEmpty ? nil : search
      )
      withAnimation {
        if reset {
          designs = page.designs
        } else {
          designs.append(contentsOf: page.designs)
        }
        let next = page.offset + page.limit
        nextPageOffset = next < page.count ? next : nil
        loading = false
      }
    } catch {
      withAnimation {
        loading = false
        // A failed next page stops paging instead of retrying forever.
        nextPageOffset = nil
        errorText = (error as? LocalizedError)?.errorDescription
          ?? "Couldn't load designs."
      }
    }
  }
}

// MARK: - Row

private struct DesignRow: View {
  let design: PartnerDesignRow

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      DesignThumb(name: design.name, thumbnail: design.displayThumbnail, size: 52)
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text(design.name ?? "Untitled design")
            .font(.body.weight(.semibold))
            .lineLimit(1)
          Spacer(minLength: 8)
          if let status = design.partner_info?.partner_status {
            DesignPartnerStatusBadge(status: status)
          }
        }
        HStack(spacing: 8) {
          if let status = design.status {
            Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          if design.partner_engagement == "owned" {
            Text("Yours")
              .font(.caption2.weight(.semibold))
              .foregroundStyle(.secondary)
          }
          Spacer()
          if let date = design.created_at {
            Text(Self.date.string(from: date))
              .font(.caption)
              .foregroundStyle(.tertiary)
          }
        }
      }
    }
    .padding(.vertical, 4)
  }

  static let date: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d, yyyy"
    return f
  }()
}

private struct ContentEmptyView: View {
  var searching: Bool

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "paintpalette")
        .font(.largeTitle)
        .foregroundStyle(.tertiary)
      Text(searching ? "No matching designs" : "No designs")
        .font(.headline)
      Text(searching
        ? "Try a different name."
        : "Designs shared with you, or that you create, will show up here.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
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
      Text("Couldn't load designs")
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
