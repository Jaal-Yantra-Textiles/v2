import SwiftUI

/// Auth gate: restores the session on cold start, then swaps between the
/// login screen and the tabbed partner area.
struct RootView: View {
  @EnvironmentObject private var auth: AuthStore

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
          ProfileView()
            .tabItem { Label("Profile", systemImage: "person") }
        }
    }
  }
}
