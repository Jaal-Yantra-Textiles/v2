import SwiftUI

/// The Work-status badge — mobile counterpart of the web list's StatusBadge.
/// Progress states are warm, terminal success is green, refusals are red,
/// admin cancels stay neutral.
struct WorkStatusBadge: View {
  let status: WorkStatus

  private var tint: Color {
    switch status {
    case .assigned: return .indigo
    case .accepted: return .blue
    case .inProgress, .partial: return .orange
    case .finished, .completed: return .green
    case .declined: return .red
    case .cancelled: return .gray
    }
  }

  var body: some View {
    Text(status.label)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(tint.opacity(0.15), in: Capsule())
      .foregroundStyle(tint)
  }
}

/// The design's picture — flagged thumbnail resolved server-side, initial
/// as the fallback. Mirrors the web DesignCell.
struct DesignThumb: View {
  var name: String?
  var thumbnail: String?
  var size: CGFloat = 44

  var body: some View {
    Group {
      if let urlString = thumbnail, let url = URL(string: urlString) {
        AsyncImage(url: url) { phase in
          switch phase {
          case .success(let image):
            image.resizable().scaledToFill()
          default:
            placeholder
          }
        }
      } else {
        placeholder
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: 8))
  }

  private var placeholder: some View {
    ZStack {
      Rectangle().fill(Color(.tertiarySystemFill))
      Text(String((name ?? "Design").prefix(1)).uppercased())
        .font(.title3.weight(.semibold))
        .foregroundStyle(.secondary)
    }
  }
}
