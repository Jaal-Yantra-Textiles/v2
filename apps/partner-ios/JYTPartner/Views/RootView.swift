import SwiftUI

/// Auth gate: restores the session on cold start, then swaps between the
/// login screen and the tabbed partner area. A push tap that named a run
/// (PushManager.pendingRunID) is honored once the area is up — deep links
/// while signed out fall back to sign-in (the run id is stale by then).
struct RootView: View {
  @EnvironmentObject private var auth: AuthStore
  @EnvironmentObject private var push: PushManager

  var body: some View {
    switch auth.state {
    case .restoring:
      ProgressView()
        .controlSize(.large)
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
    }
  }
}
