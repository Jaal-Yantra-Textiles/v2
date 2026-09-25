import SwiftUI

/// A production run, mobile counterpart of the partner-ui work-order run
/// page: the lifecycle (accepted → started → finished → completed) and the
/// dispatched task list from `GET /partners/production-runs/:id`.
struct RunDetailView: View {
  let runID: String

  @State private var detail: ProductionRunDetail?
  @State private var design: DesignDetail?
  @State private var loading = true
  @State private var errorText: String?
  @State private var actionError: String?
  @State private var pendingAction: RunAction?
  @State private var showFinishSheet = false
  @State private var showCompleteSheet = false
  @State private var acting = false

  private var pendingTasks: [RunTask] {
    (detail?.tasks ?? []).filter {
      !["completed", "cancelled"].contains($0.status ?? "")
    }
  }

  private var isSample: Bool {
    detail?.production_run.run_type == "sample"
  }

  var body: some View {
    Group {
      if let detail {
        List {
          RunNextStepSection(
            run: detail.production_run,
            isSample: isSample
          ) { action in
            handle(action)
          }
          .listRowBackground(Color(.secondarySystemGroupedBackground))

          Section("Run") {
            if let status = detail.production_run.status {
              LabeledContent("Status") { RunStatusBadge(status: status) }
            }
            if let runType = detail.production_run.run_type {
              LabeledContent("Type", value: runType == "sample" ? "Sample" : "Production")
            }
            if let role = detail.production_run.role, !role.isEmpty {
              LabeledContent("Role", value: role)
            }
            if let qty = detail.production_run.quantity {
              LabeledContent("Quantity", value: "\(qty)")
            }
          }

          if let designID = detail.production_run.design_id {
            Section("Design") {
              NavigationLink {
                DesignDetailView(designID: designID, fallbackRow: nil)
              } label: {
                Label("Open design", systemImage: "square.grid.2x2")
              }
            }
          }

          Section("Lifecycle") {
            lifecycleRow("Accepted", detail.production_run.accepted_at)
            lifecycleRow("Started", detail.production_run.started_at)
            lifecycleRow("Finished", detail.production_run.finished_at)
            lifecycleRow("Completed", detail.production_run.completed_at,
                         systemImage: "checkmark.circle.fill")
            if let created = detail.production_run.created_at {
              lifecycleRow("Created", created)
            }
          }

          let tasks = detail.tasks ?? []
          Section("Tasks") {
            if tasks.isEmpty {
              Text("No tasks dispatched.")
                .font(.footnote).foregroundStyle(.tertiary)
            } else {
              ForEach(tasks) { task in
                TaskRow(task: task)
              }
            }
          }
        }
        .navigationTitle("Run")
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
    .confirmationDialog(
      "Confirm",
      isPresented: Binding(
        get: { pendingAction == .accept || pendingAction == .start },
        set: { if !$0 { pendingAction = nil } }
      ),
      presenting: pendingAction
    ) { action in
      Button(
        action == .accept ? "Accept this run" : "Start production",
        role: .none
      ) {
        Task { await run(action) }
      }
      Button("Cancel", role: .cancel) { pendingAction = nil }
    } message: { action in
      Text(
        action == .accept
          ? "Confirm you'll handle this work?"
          : "Mark this run as started?"
      )
    }
    .sheet(isPresented: $showFinishSheet) {
      FinishRunSheet(
        pendingTasks: pendingTasks,
        isSample: isSample,
        consumptionCount: -1
      ) { notes in
        Task { await run(.finish, notes: notes) }
      }
    }
    .sheet(isPresented: $showCompleteSheet) {
      CompleteRunSheet(
        orderedQuantity: detail?.production_run.quantity ?? 0,
        materials: design?.inventory_items ?? []
      ) { body in
        Task { await run(.complete, completeBody: body) }
      }
    }
    .alert("Action failed", isPresented: Binding(
      get: { actionError != nil },
      set: { if !$0 { actionError = nil } }
    )) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(actionError ?? "")
    }
  }

  private func lifecycleRow(_ label: String, _ date: Date?, systemImage: String = "circle") -> some View {
    HStack {
      Label(label, systemImage: date == nil ? "circle.dashed" : systemImage)
        .font(date == nil ? .body : .body.weight(.medium))
        .foregroundStyle(date == nil ? Color.secondary : Color.primary)
      Spacer()
      Text(date.flatMap { Self.date.string(from: $0) } ?? "Not yet")
        .font(.footnote)
        .foregroundStyle(date == nil ? Color.gray : Color.secondary)
    }
  }

  @MainActor
  private func load() async {
    loading = detail == nil
    errorText = nil
    do {
      detail = try await PartnerAPI.shared.productionRun(id: runID)
      loading = false
      // The linked design carries the complete form's material options.
      if design == nil, let designID = detail?.production_run.design_id {
        design = try? await PartnerAPI.shared.design(id: designID)
      }
    } catch {
      loading = false
      errorText = (error as? LocalizedError)?.errorDescription
        ?? "Couldn't load this run."
    }
  }

  // MARK: - Actions

  private func handle(_ action: RunAction) {
    actionError = nil
    switch action {
    case .accept, .start:
      pendingAction = action
    case .finish:
      showFinishSheet = true
    case .complete:
      showCompleteSheet = true
    }
  }

  @MainActor
  private func run(
    _ action: RunAction,
    notes: String? = nil,
    completeBody: PartnerAPI.CompleteRunBody? = nil
  ) async {
    guard !acting else { return }
    acting = true
    defer { acting = false }
    do {
      switch action {
      case .accept:
        try await PartnerAPI.shared.acceptRun(id: runID)
      case .start:
        try await PartnerAPI.shared.startRun(id: runID)
      case .finish:
        try await PartnerAPI.shared.finishRun(id: runID, notes: notes)
      case .complete:
        try await PartnerAPI.shared.completeRun(
          id: runID, body: completeBody ?? PartnerAPI.CompleteRunBody())
      }
      pendingAction = nil
      // Let the list screens (orders, designs, order detail) know the run
      // moved — mirrors the web hooks' query invalidation.
      NotificationCenter.default.post(name: .runDidMutate, object: nil)
      await load()
    } catch {
      actionError = (error as? LocalizedError)?.errorDescription
        ?? "The action could not be completed."
    }
  }

  static let date: DateFormatter = {
    let f = DateFormatter()
    f.dateStyle = .medium
    f.timeStyle = .short
    return f
  }()
}

private struct TaskRow: View {
  let task: RunTask

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: icon)
        .foregroundStyle(tint)
      VStack(alignment: .leading, spacing: 2) {
        Text(task.title ?? "Task")
          .font(.body.weight(.medium))
        if let status = task.status {
          Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      Spacer()
      if let priority = task.priority {
        Text(priority.capitalized)
          .font(.caption2)
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(Color.gray.opacity(0.15), in: Capsule())
          .foregroundStyle(.secondary)
      }
    }
  }

  private var icon: String {
    switch task.status ?? "" {
    case "completed": return "checkmark.circle.fill"
    case "in_progress": return "arrow.circlepath"
    case "blocked": return "exclamationmark.circle"
    default: return "circle.dashed"
    }
  }

  private var tint: Color {
    switch task.status ?? "" {
    case "completed": return .green
    case "in_progress": return .orange
    case "blocked": return .red
    default: return .secondary
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
      Text("Couldn't load this run").font(.headline)
      Text(message).font(.subheadline).foregroundStyle(.secondary)
      Button("Retry", action: retry).buttonStyle(.bordered)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 40)
  }
}
