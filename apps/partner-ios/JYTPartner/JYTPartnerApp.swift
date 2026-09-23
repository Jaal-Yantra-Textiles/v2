import SwiftUI

@main
struct JYTPartnerApp: App {
  @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
  @StateObject private var auth = AuthStore()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(auth)
        .environmentObject(PushManager.shared)
    }
  }
}
