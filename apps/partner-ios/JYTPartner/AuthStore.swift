import Foundation
import SwiftUI

/// Holds the partner session: restores on cold start from the Keychain
/// token by asking `/partners/me`, and exposes login/logout.
@MainActor
final class AuthStore: ObservableObject {
  enum State {
    case restoring
    case signedOut
    case signedIn(PartnerMe)
  }

  @Published var state: State = .restoring

  var partnerMe: PartnerMe? {
    if case .signedIn(let me) = state { return me }
    return nil
  }

  init() {
    Task { await restore() }
  }

  private func restore() async {
    guard Keychain.loadToken() != nil else {
      state = .signedOut
      return
    }
    do {
      let me = try await PartnerAPI.shared.me()
      state = .signedIn(me)
    } catch {
      // A stored token /partners/me no longer accepts is as good as none.
      Keychain.clearToken()
      state = .signedOut
    }
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
    state = .signedIn(me)
  }

  func logout() {
    PartnerAPI.shared.logout()
    state = .signedOut
  }
}
