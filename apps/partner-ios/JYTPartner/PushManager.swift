import Foundation
import UIKit
import UserNotifications

/// The push leg of the partner notification system, client side.
///
/// The backend's `notification-push` provider fans every partner feed
/// notification out over APNs (see
/// apps/backend/src/modules/notification-push/). This manager:
///
///   1. asks for notification permission when the partner signs in,
///   2. registers for remote notifications and uploads the APNs device
///      token to `POST /partners/device-tokens` (which upserts, so token
///      rotation never leaves a stale row),
///   3. surfaces foreground pushes the same way the system does background
///      ones, and
///   4. turns a tap on a run reminder into a navigation hand-off — the
///      `data.production_run_id` the provider stamps travels through
///      `.pushRouteRunID` to whoever is listening (RootView).
///
/// A token upload failure is logged and retried on the next cold start —
/// missing a push must never break the app itself.
@MainActor
final class PushManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
  static let shared = PushManager()

  /// The run id a push wants opened — RootView observes this and navigates.
  @Published var pendingRunID: String?

  private var requestedAuthorization = false

  func configure() {
    UNUserNotificationCenter.current().delegate = self
  }

  /// Called on sign-in (and session restore): permission, then APNs
  /// registration. The token itself arrives asynchronously through the
  /// AppDelegate adapter's `didRegisterForRemoteNotifications`.
  func enableAfterSignIn() {
    guard !requestedAuthorization else { return }
    requestedAuthorization = true

    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) {
      granted, _ in
      guard granted else { return }
      DispatchQueue.main.async {
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  /// The APNs token (64 hex, device-data not string-data) → the backend.
  nonisolated func register(token: Data) {
    let hex = token.map { String(format: "%02x", $0) }.joined()
    Task {
      do {
        try await PartnerAPI.shared.registerDeviceToken(
          token: hex,
          platform: "ios",
          appVersion: Bundle.main
            .object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        )
        await MainActor.run {
          UserDefaults.standard.set(hex, forKey: "lastAPNsTokenHex")
        }
      } catch {
        // Not fatal: the token re-registers on the next launch. A push that
        // doesn't arrive is a missed nudge, not a broken app.
        print("[push] token registration failed: \((error as? LocalizedError)?.errorDescription ?? String(describing: error))")
      }
    }
  }

  func unregisterCurrentDevice() {
    // There is no locally cached token to delete (APNs hands it to us on
    // registration only). Sign-out posts the last known token up if we have
    // one; otherwise the backend prunes it when APNs reports the install
    // gone. Kept as a no-op-safe call so ProfileView can call it blindly.
    guard let hex = lastRegisteredHex else { return }
    Task {
      try? await PartnerAPI.shared.unregisterDeviceToken(token: hex)
    }
  }

  private var lastRegisteredHex: String? {
    get { UserDefaults.standard.string(forKey: "lastAPNsTokenHex") }
    set { UserDefaults.standard.set(newValue, forKey: "lastAPNsTokenHex") }
  }

  // MARK: - UNUserNotificationCenterDelegate

  /// Foreground pushes should still be seen — default is silent, which
  /// would hide exactly the nudges this app exists for.
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound, .badge])
  }

  /// A tap on a push: pull the run id out of the payload the provider
  /// stamped (`data.production_run_id`) and hand it to RootView.
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let userInfo = response.notification.request.content.userInfo
    if let runID = pushRunID(from: userInfo) {
      Task { @MainActor in
        self.pendingRunID = runID
      }
    }
    completionHandler()
  }

  /// The payload shape the provider sends: APNs wraps the custom `data` at
  /// the top level; background pushes mirror it into the alert's userInfo.
  nonisolated private func pushRunID(from userInfo: [AnyHashable: Any]) -> String? {
    if let data = userInfo["data"] as? [String: Any],
       let runID = data["production_run_id"] as? String {
      return runID
    }
    return userInfo["production_run_id"] as? String
  }
}

/// UIApplicationDelegate adapter for the SwiftUI life-cycle — the only
/// delegate methods push needs that the App protocol doesn't expose.
/// `registerForRemoteNotifications` REQUIRES a UIApplicationDelegate to
/// receive its callbacks; without this adapter the token never arrives.
final class PushAppDelegate: NSObject, UIApplicationDelegate {
  static let shared = PushAppDelegate()

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    PushManager.shared.configure()
    return true
  }

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    PushManager.shared.register(token: deviceToken)
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    print("[push] APNs registration failed: \(error.localizedDescription)")
  }
}
