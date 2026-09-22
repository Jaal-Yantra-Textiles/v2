import SwiftUI
import UIKit

/// The design manager, mobile counterpart of the partner-ui design-detail
/// screen: overview + brief, media, moodboard images, colors, sizes, and
/// the matching production runs (with their completion state).
struct DesignDetailView: View {
  let designID: String
  /// Row from the list — shown instantly while the full record loads.
  var fallbackRow: PartnerDesignRow?

  @State private var design: DesignDetail?
  @State private var runs: [ProductionRun] = []
  @State private var loading = true
  @State private var errorText: String?
  @State private var viewerImage: MediaImage?

  /// An image the full-screen viewer is showing — either a remote URL or a
  /// base64 data URL (moodboard images are embedded in the scene).
  enum MediaImage: Identifiable {
    case url(String)
    case data(String)

    var id: String {
      switch self {
      case .url(let u): return u
      case .data(let d): return String(d.hashValue)
      }
    }
  }

  var body: some View {
    Group {
      if let design {
        List {
          overviewSection(design)
          mediaSection(design)
          moodboardSection(design)
          colorsSection(design)
          sizesSection(design)
          productionRunsSection
        }
        .navigationTitle(design.name ?? "Design")
        .navigationBarTitleDisplayMode(.inline)
      } else if loading {
        ProgressView().controlSize(.large)
      } else {
        ContentErrorView(message: errorText ?? "Something went wrong.") {
          Task { await load() }
        }
      }
    }
    .task { await load() }
    .sheet(item: $viewerImage) { image in
      MediaViewer(image: image)
    }
  }

  @MainActor
  private func load() async {
    loading = design == nil
    errorText = nil
    do {
      design = try await PartnerAPI.shared.design(id: designID)
      loading = false
    } catch {
      loading = false
      if let errorText {
        self.errorText = errorText
      } else if design == nil {
        self.errorText = (error as? LocalizedError)?.errorDescription
          ?? "Couldn't load this design."
      }
      return
    }
    // The matching production runs — the single source of truth for the
    // partner status + completion shown above.
    if let runsPage = try? await PartnerAPI.shared.productionRuns(designId: designID) {
      self.runs = runsPage.production_runs
    }
  }

  // MARK: - Sections

  private func overviewSection(_ design: DesignDetail) -> some View {
    Section("Overview") {
      if let status = design.status {
        LabeledContent("Status", value: status.replacingOccurrences(of: "_", with: " ").capitalized)
      }
      if let info = design.partner_info {
        LabeledContent("Your status") {
          if let s = info.partner_status {
            DesignPartnerStatusBadge(status: s)
          }
        }
        if let date = info.partner_started_at {
          LabeledContent("Started", value: Self.date.string(from: date) ?? "—")
        }
        if let date = info.partner_finished_at {
          LabeledContent("Finished", value: Self.date.string(from: date) ?? "—")
        }
        if let date = info.partner_completed_at {
          LabeledContent("Completed", value: Self.date.string(from: date) ?? "—")
        }
      }
      if let type = design.design_type {
        LabeledContent("Type", value: type)
      }
      if let productType = design.product_type {
        LabeledContent("Product", value: productType.capitalized)
      }
      if let cost = design.estimated_cost?.value {
        LabeledContent("Estimated cost") {
          Text(Self.currency.string(cost, code: design.cost_currency ?? "inr"))
        }
      }
      if let theme = design.concept_theme, !theme.isEmpty {
        LabeledContent("Concept", value: theme)
      }
      if let keywords = design.aesthetic_keywords, !keywords.isEmpty {
        LabeledContent("Aesthetic") {
          Text(keywords.joined(separator: ", "))
            .multilineTextAlignment(.trailing)
        }
      }
      if let created = design.created_at {
        LabeledContent("Created", value: Self.date.string(from: created) ?? "—")
      }
      if let notes = design.designer_notes, !notes.isEmpty {
        Text(notes).font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  private func mediaSection(_ design: DesignDetail) -> some View {
    let files = (design.media_files ?? []).sorted { ($0.isThumbnail ?? false) && !($1.isThumbnail ?? false) }
    return Section("Media") {
      if files.isEmpty {
        Text("No media attached.")
          .font(.footnote).foregroundStyle(.tertiary)
      } else {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(files) { file in
              Button {
                viewerImage = .url(file.url)
              } label: {
                AsyncImage(url: URL(string: file.url)) { phase in
                  switch phase {
                  case .success(let image):
                    image.resizable().scaledToFill()
                  default:
                    ZStack {
                      Color(.tertiarySystemFill)
                      Image(systemName: "photo")
                        .foregroundStyle(.tertiary)
                    }
                  }
                }
                .frame(width: 92, height: 92)
                .clipShape(RoundedRectangle(cornerRadius: 10))
              }
              .buttonStyle(.plain)
            }
          }
          .padding(.vertical, 4)
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
      }
    }
  }

  private func moodboardSection(_ design: DesignDetail) -> some View {
    let images = design.moodboard?.imageDataURLs ?? []
    return Section("Moodboard") {
      if images.isEmpty {
        Text("No moodboard images yet.")
          .font(.footnote).foregroundStyle(.tertiary)
      } else {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(images, id: \.id) { item in
              Button {
                viewerImage = .data(item.data)
              } label: {
                if let ui = Self.uiImage(fromDataURL: item.data) {
                  Image(uiImage: ui)
                    .resizable()
                    .scaledToFill()
                } else {
                  ZStack {
                    Color(.tertiarySystemFill)
                    Image(systemName: "photo.on.rectangle")
                      .foregroundStyle(.tertiary)
                  }
                }
              }
              .frame(width: 92, height: 92)
              .clipShape(RoundedRectangle(cornerRadius: 10))
              .buttonStyle(.plain)
            }
          }
          .padding(.vertical, 4)
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
      }
    }
  }

  private func colorsSection(_ design: DesignDetail) -> some View {
    let colors = design.colors ?? []
    return Group {
      if !colors.isEmpty {
        Section("Colors") {
          ForEach(colors) { color in
            HStack(spacing: 12) {
              Circle()
                .fill(Color(hex: color.hex_code) ?? .secondary)
                .frame(width: 28, height: 28)
                .overlay(Circle().strokeBorder(.quaternary))
              VStack(alignment: .leading, spacing: 2) {
                Text(color.name).font(.body)
                if let notes = color.usage_notes, !notes.isEmpty {
                  Text(notes).font(.caption).foregroundStyle(.secondary)
                }
              }
            }
          }
        }
      }
    }
  }

  private func sizesSection(_ design: DesignDetail) -> some View {
    let sizes = design.size_sets ?? []
    return Group {
      if !sizes.isEmpty {
        Section("Sizes") {
          ForEach(sizes) { size in
            VStack(alignment: .leading, spacing: 4) {
              Text(size.size_label).font(.body.weight(.semibold))
              if let measurements = size.measurements, !measurements.isEmpty {
                let sorted = measurements.sorted { $0.key < $1.key }
                Text(
                  sorted
                    .map { "\($0.key.capitalized): \($0.value.value.map { String(format: "%.1f", $0) } ?? "—")" }
                    .joined(separator: "  ·  ")
                )
                .font(.caption)
                .foregroundStyle(.secondary)
              }
            }
          }
        }
      }
    }
  }

  private var productionRunsSection: some View {
    Section("Production runs") {
      if runs.isEmpty {
        Text("No production runs on this design.")
          .font(.footnote).foregroundStyle(.tertiary)
      } else {
        ForEach(runs) { run in
          NavigationLink {
            RunDetailView(runID: run.id)
          } label: {
            RunRow(run: run)
          }
        }
      }
    }
  }

  // MARK: - Helpers

  static func uiImage(fromDataURL dataURL: String) -> UIImage? {
    guard let comma = dataURL.firstIndex(of: ",") else { return nil }
    let base64 = String(dataURL[dataURL.index(after: comma)...])
    guard let data = Data(base64Encoded: base64) else { return nil }
    return UIImage(data: data)
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

// MARK: - Rows & viewer

private struct RunRow: View {
  let run: ProductionRun

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(run.run_type == "sample" ? "Sample run" : "Production run")
          .font(.body.weight(.semibold))
        Spacer(minLength: 8)
        RunStatusBadge(status: run.status ?? "—")
      }
      HStack(spacing: 16) {
        if let qty = run.quantity {
          Text("Qty \(qty)").font(.caption).foregroundStyle(.secondary)
        }
        if let date = run.completed_at {
          Label(Self.shortDate.string(from: date) ?? "—", systemImage: "checkmark.circle")
            .font(.caption)
            .foregroundStyle(.green)
        } else if let date = run.finished_at {
          Label(Self.shortDate.string(from: date) ?? "—", systemImage: "clock")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
    .padding(.vertical, 2)
  }

  static let shortDate: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d"
    return f
  }()
}

/// Full-screen media/moodboard viewer — pinch to zoom, tap to dismiss.
private struct MediaViewer: View {
  let image: DesignDetailView.MediaImage
  @Environment(\.dismiss) private var dismiss
  @State private var scale: CGFloat = 1

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      Group {
        switch image {
        case .url(let urlString):
          if let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
              switch phase {
              case .success(let img): img.resizable().scaledToFit()
              default: ProgressView().tint(.white)
              }
            }
          }
        case .data(let dataURL):
          if let ui = DesignDetailView.uiImage(fromDataURL: dataURL) {
            Image(uiImage: ui).resizable().scaledToFit()
          } else {
            Text("Couldn't decode image").foregroundStyle(.white)
          }
        }
      }
      .scaleEffect(scale)
      .gesture(
        MagnificationGesture()
          .onChanged { scale = max(1, $0) }
          .onEnded { _ in withAnimation { scale = 1 } }
      )
      .onTapGesture { dismiss() }
    }
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
      Text("Couldn't load this design").font(.headline)
      Text(message).font(.subheadline).foregroundStyle(.secondary)
      Button("Retry", action: retry).buttonStyle(.bordered)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 40)
  }
}

// MARK: - Hex color

extension Color {
  init?(hex: String) {
    var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    value = value.replacingOccurrences(of: "#", with: "")
    guard value.count == 3 || value.count == 6,
          let rgb = UInt64(value, radix: 16) else { return nil }
    var r, g, b: UInt64
    if value.count == 3 {
      r = (rgb >> 8) & 0xF; r = (r << 4) | r
      g = (rgb >> 4) & 0xF; g = (g << 4) | g
      b = rgb & 0xF; b = (b << 4) | b
    } else {
      r = (rgb >> 16) & 0xFF
      g = (rgb >> 8) & 0xFF
      b = rgb & 0xFF
    }
    self.init(
      red: Double(r) / 255,
      green: Double(g) / 255,
      blue: Double(b) / 255
    )
  }
}
