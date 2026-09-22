import SwiftUI

@main
struct JYTPartnerApp: App {
  @StateObject private var auth = AuthStore()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(auth)
    }
  }
}
