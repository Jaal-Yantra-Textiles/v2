import SwiftUI

/// Auth gate: restores the session on cold start, then swaps between the
/// login screen and the tabbed partner area. A push tap that named a run
/// (PushManager.pendingRunID) is honored once the area is up — deep links
/// while signed out fall back to sign-in (the run id is stale by then).
struct RootView: View {
  @EnvironmentObject private var auth: AuthStore
  @EnvironmentObject private var push: PushManager
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    content
      .onChange(of: scenePhase) { phase in
        // Back in the foreground: refresh a token older than 6 h so a
        // partner who opens the app daily never meets an expired one.
        if phase == .active { auth.refreshIfStale() }
      }
  }

  @ViewBuilder
  private var content: some View {
    switch auth.state {
    case .restoring:
      ProgressView()
        .controlSize(.large)
    case .restoreFailed:
      RestoreFailedView(
        onRetry: { auth.retryRestore() },
        onSignOut: { auth.logout() })
    case .signedOut:
      LoginView()
    case .signedIn:
      TabView {
        DesignOrdersView()
          .tabItem { Label("Orders", systemImage: "shirt") }
        InventoryOrdersView()
          .tabItem { Label("Inventory", systemImage: "shippingbox") }
        ProfileView()
          .tabItem { Label("Profile", systemImage: "person") }
      }
      .onAppear { push.enableAfterSignIn() }
      .sheet(isPresented: Binding(
        get: { push.pendingRunID != nil },
        set: { if !$0 { push.pendingRunID = nil } }
      )) {
        if let runID = push.pendingRunID {
          NavigationStack {
            RunDetailView(runID: runID)
              .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                  Button("Close") { push.pendingRunID = nil }
                }
              }
          }
        }
      }
    }
  }
}

/// The session could not be restored because the server did not answer (or
/// errored) — NOT because the token was refused. The sign-in is kept, so
/// Retry re-runs the restore instead of sending the partner to log in.
private struct RestoreFailedView: View {
  let onRetry: () -> Void
  let onSignOut: () -> Void

  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: "wifi.exclamationmark")
        .font(.system(size: 40))
        .foregroundStyle(.secondary)
      Text("Couldn't restore your session")
        .font(.headline)
      Text("Your sign-in is kept. Check your connection and try again.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 40)
      Button("Retry", action: onRetry)
        .buttonStyle(.borderedProminent)
      Button("Sign out", role: .destructive, action: onSignOut)
        .font(.footnote)
        .padding(.top, 8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
