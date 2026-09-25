import PhotosUI
import SwiftUI

/// A design work-order, mobile counterpart of the partner-ui work-order
/// page. Leads with the BIG next-step action (the web pins it first), opens
/// an action sheet for everything the partner can do here (accept / start /
/// finish / complete / add media), and shows the design's media with
/// thumbnails, plus a camera/library upload for photos and videos.
struct OrderDetailView: View {
  let orderID: String
  /// The row from the Design Orders list — carries design summary + currency.
  var listRow: PartnerOrder?

  @State private var detail: PartnerOrder?
  @State private var runDetails: [ProductionRun] = []
  @State private var runTasks: [String: [RunTask]] = [:]
  @State private var design: DesignDetail?
  @State private var runsLoading = false
  @State private var loading = true
  @State private var errorText: String?

  // Actions
  @State private var showActionSheet = false
  @State private var confirmAction: RunAction?
  @State private var showFinishSheet = false
  @State private var showCompleteSheet = false
  @State private var actionError: String?
  @State private var acting = false

  // Media upload
  @State private var showMediaDialog = false
  @State private var showCamera = false
  @State private var photoItem: PhotosPickerItem?
  @State private var uploading = false

  private var display: PartnerOrder {
    detail ?? listRow ?? PartnerOrder(
      id: orderID, display_id: 0, status: "—", total: 0,
      created_at: Date(timeIntervalSince1970: 0))
  }

  /// The run the big action acts on: the first non-terminal one.
  private var activeRun: ProductionRun? {
    runDetails.first {
      !["completed", "cancelled"].contains($0.status ?? "")
    }
  }

  private var isSample: Bool { activeRun?.run_type == "sample" }

  private var pendingTasks: [RunTask] {
    activeRun.flatMap { runTasks[$0.id] } ?? []
  }

  var body: some View {
    content
      .navigationTitle("Order #\(display.display_id)")
      .navigationBarTitleDisplayMode(.inline)
      .task { await load() }
      .onReceive(NotificationCenter.default.publisher(for: .runDidMutate)) { _ in
        Task {
          await load()
          runDetails = []
          runTasks = [:]
          design = nil
          await loadRuns()
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

  /// The content plus its dialogs and sheets, kept separate from `body` so
  /// the type-checker can handle each chain on its own.
  private var content: some View {
    rootContent
      .confirmationDialog(
        "Work actions",
        isPresented: $showActionSheet,
        titleVisibility: .visible
      ) {
        if let action = nextActionForActiveRun {
          Button(action.label) { handle(action) }
        }
        Button("Add photo or video") { showMediaDialog = true }
        Button("Cancel", role: .cancel) {}
      } message: {
        if let action = nextActionForActiveRun {
          Text(action.hint(isSample: isSample))
        } else {
          Text("Log progress media for this work-order.")
        }
      }
      .confirmationDialog(
        "Confirm",
        isPresented: Binding(
          get: { confirmAction == .accept || confirmAction == .start },
          set: { if !$0 { confirmAction = nil } }
        ),
        presenting: confirmAction
      ) { action in
        Button(action == .accept ? "Accept this run" : "Start production") {
          Task { await run(action) }
        }
        Button("Cancel", role: .cancel) { confirmAction = nil }
      } message: { action in
        Text(
          action == .accept
            ? "Confirm you'll handle this work?"
            : "Mark this run as started?"
        )
      }
      .sheet(isPresented: $showFinishSheet) { finishSheet }
      .sheet(isPresented: $showCompleteSheet) { completeSheet }
      .confirmationDialog(
        "Add photo or video",
        isPresented: $showMediaDialog,
        titleVisibility: .visible
      ) {
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
          Button("Take photo or video") { showCamera = true }
        }
        Button("Choose from library") { mediaLibraryPresented = true }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("Uploaded media is attached to this run's design.")
      }
      .sheet(isPresented: $showCamera) {
        CameraPicker { pick in Task { await upload(pick) } }
      }
      .sheet(isPresented: $mediaLibraryPresented) { libraryPicker }
      .onChange(of: photoItem) { item in
        guard let item else { return }
        mediaLibraryPresented = false
        photoItem = nil
        Task {
          if let pick = await MediaLoader.load(item) {
            await upload(pick)
          }
        }
      }
  }

  @ViewBuilder
  private var rootContent: some View {
    if detail != nil || listRow != nil {
      orderList
    } else if loading {
      ProgressView().controlSize(.large)
    } else {
      ContentErrorView(message: errorText ?? "Something went wrong.") {
        Task { await load() }
      }
    }
  }

  private var finishSheet: some View {
    FinishRunSheet(
      pendingTasks: pendingTasks,
      isSample: isSample,
      consumptionCount: -1
    ) { notes in
      Task { await run(.finish, notes: notes) }
    }
  }

  private var completeSheet: some View {
    CompleteRunSheet(
      orderedQuantity: activeRun?.quantity ?? 0,
      materials: design?.inventory_items ?? []
    ) { body in
      Task { await run(.complete, completeBody: body) }
    }
  }

  private var libraryPicker: some View {
    PhotosPicker(selection: $photoItem, matching: .any(of: [.images, .videos])) {
      VStack(spacing: 10) {
        Image(systemName: "photo.on.rectangle.angled")
          .font(.system(size: 40))
        Text("Choose photo or video")
          .font(.headline)
      }
      .frame(maxWidth: .infinity, minHeight: 420)
      .frame(maxHeight: .infinity)
      .background(Color(.secondarySystemBackground))
    }
    .buttonStyle(.plain)
    .presentationDetents([.medium])
  }

  @State private var mediaLibraryPresented = false

  // MARK: - Content

  private var orderList: some View {
    List {
      nextStepSection

      Section("Summary") {
        LabeledContent("Order #", value: "#\(display.display_id)")
        LabeledContent("Created", value: Self.date.string(from: display.created_at) ?? "—")
        LabeledContent("Total") {
          Text(Self.currency.string(display.total, code: display.currency_code ?? ""))
            .font(.body.weight(.semibold))
        }
        if let status = display.workStatus {
          LabeledContent("Work status") { WorkStatusBadge(status: status) }
        }
        if let payment = display.payment_status, !payment.isEmpty {
          LabeledContent("Payment", value: payment.replacingOccurrences(of: "_", with: " "))
        }
        if let fulfillment = display.fulfillment_status, !fulfillment.isEmpty {
          LabeledContent("Fulfillment", value: fulfillment.replacingOccurrences(of: "_", with: " "))
        }
      }

      designsSection

      let items = display.items ?? []
      if !items.isEmpty {
        Section("Items") {
          ForEach(items) { item in
            HStack(spacing: 10) {
              DesignThumb(name: item.title, thumbnail: item.thumbnail, size: 36)
              VStack(alignment: .leading, spacing: 2) {
                Text(item.title ?? "Item")
                  .font(.body.weight(.medium))
                HStack(spacing: 12) {
                  Text("Qty \(item.quantity)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                  Text(Self.currency.string(item.total, code: display.currency_code ?? ""))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }
            }
          }
        }
      }

      mediaSection

      productionRunsSection
    }
  }

  /// The BIG pinned block, the web's RunNextAction: the one thing to do,
  /// full-width, tap → action sheet.
  private var nextStepSection: some View {
    Section {
      VStack(alignment: .leading, spacing: 10) {
        Text("Your next step")
          .font(.body.weight(.semibold))
        if let action = nextActionForActiveRun {
          Text(action.hint(isSample: isSample))
            .font(.footnote)
            .foregroundStyle(.secondary)
          Button {
            showActionSheet = true
          } label: {
            HStack(spacing: 8) {
              if acting || uploading {
                ProgressView().tint(.white)
              } else {
                Image(systemName: icon(for: action))
              }
              Text(action.label)
                .font(.headline)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
          }
          .buttonStyle(.borderedProminent)
          .disabled(acting || uploading)
        } else if uploading {
          HStack(spacing: 8) {
            ProgressView()
            Text("Uploading media…").font(.footnote).foregroundStyle(.secondary)
          }
        } else {
          Button {
            showActionSheet = true
          } label: {
            Label("Add photo or video", systemImage: "camera")
              .frame(maxWidth: .infinity)
              .font(.body.weight(.semibold))
          }
          .buttonStyle(.bordered)
        }
      }
      .padding(.vertical, 4)
    }
    .listRowBackground(Color(.secondarySystemGroupedBackground))
  }

  private var nextActionForActiveRun: RunAction? {
    activeRun.flatMap { nextRunAction(for: $0) }
  }

  /// Design thumbnails — the flagged/first media of the linked design, like
  /// the web's DesignCell. The list row's summary leads; the full design
  /// record (fetched for media + materials) refreshes the thumbnail.
  private var designsSection: some View {
    let designs = display.designs ?? []
    return Group {
      if !designs.isEmpty || design != nil {
        Section("Designs") {
          if let design {
            NavigationLink {
              DesignDetailView(designID: design.id, fallbackRow: nil)
            } label: {
              HStack(spacing: 12) {
                DesignThumb(
                  name: design.name,
                  thumbnail: design.thumbnail_url ?? design.media_files?.first(where: { $0.isThumbnail ?? false })?.url ?? design.media_files?.first?.url,
                  size: 44
                )
                VStack(alignment: .leading, spacing: 2) {
                  Text(design.name ?? "Untitled design")
                    .font(.body.weight(.semibold))
                  if let status = design.partner_info?.partner_status {
                    DesignPartnerStatusBadge(status: status)
                  }
                }
              }
            }
          }
          ForEach(designs) { design in
            NavigationLink {
              DesignDetailView(designID: design.id, fallbackRow: nil)
            } label: {
              HStack(spacing: 12) {
                DesignThumb(name: design.name, thumbnail: design.thumbnail, size: 44)
                Text(design.name ?? "Untitled design")
              }
            }
          }
        }
      }
    }
  }

  /// The design's media gallery + the upload entry, mirroring the web media
  /// section. Uploaded photos/videos attach to the design's media_files.
  private var mediaSection: some View {
    let files = design?.media_files ?? []
    return Section("Media") {
      if files.isEmpty && !uploading {
        Text("No media yet — capture the work in progress.")
          .font(.footnote).foregroundStyle(.tertiary)
      }
      if !files.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(files) { file in
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
              .frame(width: 88, height: 88)
              .clipShape(RoundedRectangle(cornerRadius: 10))
            }
          }
          .padding(.vertical, 4)
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
      }
      Button {
        showMediaDialog = true
      } label: {
        Label(
          uploading ? "Uploading…" : "Add photo or video",
          systemImage: uploading ? "hourglass" : "camera"
        )
      }
      .disabled(uploading)
    }
  }

  private var productionRunsSection: some View {
    Section("Production runs") {
      if runRefs.isEmpty && runDetails.isEmpty {
        Text("No production runs on this order.")
          .font(.footnote).foregroundStyle(.tertiary)
      } else if runDetails.isEmpty && runsLoading {
        HStack { Spacer(); ProgressView(); Spacer() }
      } else {
        ForEach(runDetails) { run in
          NavigationLink {
            RunDetailView(runID: run.id)
          } label: {
            runRow(run)
          }
        }
      }
    }
  }

  private func runRow(_ run: ProductionRun) -> some View {
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

  private var runRefs: [ProductionRunRef] {
    detail?.production_runs ?? listRow?.production_runs ?? []
  }

  // MARK: - Loading

  @MainActor
  private func load() async {
    loading = detail == nil && listRow == nil
    errorText = nil
    do {
      let fetched = try await PartnerAPI.shared.order(id: orderID)
      withAnimation { detail = fetched }
      loading = false
      await loadRuns()
    } catch {
      loading = false
      if listRow == nil {
        errorText = (error as? LocalizedError)?.errorDescription
          ?? "Couldn't load this order."
      }
    }
  }

  /// Run refs arrive as bare ids; fetch each, and pull the linked design for
  /// media + the complete form's material options.
  @MainActor
  private func loadRuns() async {
    let refs = runRefs
    guard !refs.isEmpty, runDetails.isEmpty else { return }
    runsLoading = true
    var loaded: [ProductionRun] = []
    var designID: String?
    for ref in refs.prefix(10) {
      if let runDetail = try? await PartnerAPI.shared.productionRun(id: ref.id) {
        loaded.append(runDetail.production_run)
        runTasks[runDetail.production_run.id] = runDetail.tasks ?? []
        if designID == nil {
          designID = runDetail.production_run.design_id
        }
      }
    }
    withAnimation {
      runDetails = loaded
      runsLoading = false
    }
    if let designID, design == nil {
      design = try? await PartnerAPI.shared.design(id: designID)
    }
  }

  // MARK: - Actions

  private func handle(_ action: RunAction) {
    actionError = nil
    switch action {
    case .accept, .start:
      confirmAction = action
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
    guard let run = activeRun else { return }
    guard !acting else { return }
    acting = true
    defer { acting = false }
    do {
      switch action {
      case .accept:
        try await PartnerAPI.shared.acceptRun(id: run.id)
      case .start:
        try await PartnerAPI.shared.startRun(id: run.id)
      case .finish:
        try await PartnerAPI.shared.finishRun(id: run.id, notes: notes)
      case .complete:
        try await PartnerAPI.shared.completeRun(
          id: run.id, body: completeBody ?? PartnerAPI.CompleteRunBody())
      }
      confirmAction = nil
      NotificationCenter.default.post(name: .runDidMutate, object: nil)
      runDetails = []
      design = nil
      await load()
    } catch {
      actionError = (error as? LocalizedError)?.errorDescription
        ?? "The action could not be completed."
    }
  }

  /// Two-step, like the web: upload the file(s), then attach to the design.
  @MainActor
  private func upload(_ pick: MediaFilePick) async {
    guard let run = activeRun ?? runDetails.first else {
      actionError = "This order has no production run to attach media to."
      return
    }
    uploading = true
    defer { uploading = false }
    do {
      let uploaded = try await PartnerAPI.shared.uploadRunMedia(
        runId: run.id,
        parts: [PartnerAPI.MediaPart(
          filename: pick.filename,
          mimeType: pick.mimeType,
          data: pick.data
        )]
      )
      try await PartnerAPI.shared.attachRunMedia(runId: run.id, files: uploaded)
      // Refresh the design so the gallery shows the new file.
      if let designID = design?.id {
        design = try? await PartnerAPI.shared.design(id: designID)
      } else if let designID = run.design_id {
        design = try? await PartnerAPI.shared.design(id: designID)
      }
    } catch {
      actionError = (error as? LocalizedError)?.errorDescription
        ?? "The upload could not be completed."
    }
  }

  private func icon(for action: RunAction) -> String {
    switch action {
    case .accept: return "hand.thumbsup"
    case .start: return "play"
    case .finish: return "flag"
    case .complete: return "checkmark.circle"
    }
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

  static let shortDate: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d"
    return f
  }()
}

private struct ContentErrorView: View {
  let message: String
  let retry: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "exclamationmark.triangle")
        .font(.largeTitle)
        .foregroundStyle(.red)
      Text("Couldn't load this order").font(.headline)
      Text(message).font(.subheadline).foregroundStyle(.secondary)
      Button("Retry", action: retry).buttonStyle(.bordered)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 40)
  }
}
