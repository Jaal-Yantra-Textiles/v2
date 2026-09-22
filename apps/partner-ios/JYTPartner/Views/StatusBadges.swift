import SwiftUI

/// Status badge for a production run — the run lifecycle vocabulary
/// (pending_review / approved / sent_to_partner / in_progress / completed /
/// cancelled / awaiting_reassignment), colored like the web work-order
/// surfaces: progress warm, completed green, cancelled neutral.
struct RunStatusBadge: View {
  let status: String

  private var tint: Color {
    switch status {
    case "in_progress": return .orange
    case "finished": return .teal
    case "completed": return .green
    case "cancelled", "awaiting_reassignment": return .gray
    case "pending_review", "approved", "sent_to_partner": return .indigo
    default: return .blue
    }
  }

  private var label: String {
    status.replacingOccurrences(of: "_", with: " ")
      .capitalized
  }

  var body: some View {
    Text(label)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(tint.opacity(0.15), in: Capsule())
      .foregroundStyle(tint)
  }
}

/// Partner-facing design status chip (incoming / assigned / in_progress /
/// awaiting_review / finished / completed / cancelled) — §5 vocabulary,
/// same colors as WorkStatusBadge.
struct DesignPartnerStatusBadge: View {
  let status: String

  private var tint: Color {
    switch status {
    case "incoming": return .gray
    case "assigned": return .indigo
    case "in_progress": return .orange
    case "awaiting_review", "finished": return .teal
    case "completed": return .green
    case "cancelled": return .gray
    default: return .blue
    }
  }

  var body: some View {
    Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(tint.opacity(0.15), in: Capsule())
      .foregroundStyle(tint)
  }
}
