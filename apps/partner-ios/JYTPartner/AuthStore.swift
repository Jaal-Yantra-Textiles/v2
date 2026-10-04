import Foundation
import SwiftUI

/// When the token was last issued (login or refresh). UserDefaults is fine
/// here — it's a timestamp, not a secret; the token itself stays in the
/// Keychain.
enum SessionClock {
  private static let key = "partner.lastTokenRefresh"
  /// JWTs live a day; refreshing on foreground after 6 h keeps a partner
  /// who opens the app daily from ever holding an expired one.
  static let refreshInterval: TimeInterval = 6 * 60 * 60

  static var lastRefresh: Date? {
    UserDefaults.standard.object(forKey: key) as? Date
  }

  static func markRefreshed(_ date: Date = Date()) {
    UserDefaults.standard.set(date, forKey: key)
  }

  static func clear() {
    UserDefaults.standard.removeObject(forKey: key)
  }

  static var isStale: Bool {
    guard let lastRefresh else { return true }
    return Date().timeIntervalSince(lastRefresh) > refreshInterval
  }
}

/// Holds the partner session: restores on cold start from the Keychain
/// token (refresh, then `/partners/me`), and exposes login/logout.
///
/// The token is only thrown away when the server says it is no good — a
/// 401 from refresh or `/me`, or the session-expired signal PartnerAPI
/// posts after a failed refresh. A network error, a 5xx or an odd response
/// keeps it and parks in `.restoreFailed` with a Retry.
@MainActor
final class AuthStore: ObservableObject {
  enum State {
    case restoring
    /// Couldn't reach the server (or it errored) while restoring. The token
    /// is kept; Retry runs the restore again.
    case restoreFailed
    case signedOut
    case signedIn(PartnerMe)
  }

  @Published var state: State = .restoring
  /// Why the partner is looking at the login screen, when it wasn't their
  /// choice ("Your session expired…"). Cleared on the next sign-in.
  @Published var sessionNotice: String?

  private var refreshingOnForeground = false

  var partnerMe: PartnerMe? {
    if case .signedIn(let me) = state { return me }
    return nil
  }

  init() {
    Task { await restore() }
    Task { [weak self] in
      for await _ in NotificationCenter.default.notifications(named: .partnerSessionExpired) {
        self?.sessionExpired()
      }
    }
  }

  func retryRestore() {
    state = .restoring
    Task { await restore() }
  }

  private func restore() async {
    guard Keychain.loadToken() != nil else {
      state = .signedOut
      return
    }

    // Refresh first: a token that expired overnight is swapped for a fresh
    // one instead of being refused by /me.
    do {
      try await PartnerAPI.shared.refreshToken()
    } catch let error as PartnerError where error.isUnauthorized {
      sessionExpired()
      return
    } catch PartnerError.http(let status, _) where (400..<500).contains(status) {
      // Not a verdict on the token (e.g. the refresh route isn't deployed
      // yet) — let /me decide.
    } catch {
      state = .restoreFailed
      return
    }

    do {
      let me = try await PartnerAPI.shared.me()
      state = .signedIn(me)
    } catch let error as PartnerError where error.isUnauthorized {
      sessionExpired()
    } catch {
      // Network, 5xx or a response we couldn't read: the token may be fine.
      state = .restoreFailed
    }
  }

  /// Foreground hook: refresh when the last one is more than 6 h old. Only
  /// a refused token signs out; anything else waits for the next foreground.
  func refreshIfStale() {
    guard case .signedIn = state, SessionClock.isStale, !refreshingOnForeground else { return }
    refreshingOnForeground = true
    Task {
      defer { refreshingOnForeground = false }
      do {
        try await PartnerAPI.shared.refreshToken()
      } catch let error as PartnerError where error.isUnauthorized {
        sessionExpired()
      } catch {
        // Offline or a server hiccup — the request path will refresh on
        // its first 401 anyway.
      }
    }
  }

  /// The token was refused and couldn't be refreshed: drop it and say why.
  private func sessionExpired() {
    if case .signedOut = state { return }
    PartnerAPI.shared.logout()
    sessionNotice = PartnerError.sessionExpiredMessage
    state = .signedOut
  }

  struct LoginError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  func login(email: String, password: String) async throws {
    let outcome = try await PartnerAPI.shared.login(email: email, password: password)
    if outcome.verificationRequired {
      throw LoginError(
        message: "Your email isn't verified yet. Check your inbox for the verification code, then sign in again.")
    }
    let me = try await PartnerAPI.shared.me()
    sessionNotice = nil
    state = .signedIn(me)
  }

  /// Phone number + PIN (#2320). A 401 is a wrong number/PIN or a locked
  /// number; the generic "Invalid email or password." would mislead here.
  func loginWithPhone(phone: String, pin: String) async throws {
    do {
      try await PartnerAPI.shared.loginWithPhone(phone: phone, pin: pin)
    } catch PartnerError.http(let status, let message) where status == 401 {
      throw LoginError(
        message: message.contains("Too many wrong PINs")
          ? "Too many wrong PINs. Wait 15 minutes, or sign in with your email."
          : "Wrong phone number or PIN.")
    }
    let me = try await PartnerAPI.shared.me()
    sessionNotice = nil
    state = .signedIn(me)
  }

  func logout() {
    PartnerAPI.shared.logout()
    sessionNotice = nil
    state = .signedOut
  }
}
