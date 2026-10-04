import Foundation
import Security

/// Minimal iOS Keychain wrapper. A bearer token must never sit in
/// UserDefaults, so the partner JWT lives in the Keychain instead.
///
/// The item is readable AFTER FIRST UNLOCK: a token saved with the default
/// (`WhenUnlocked`) is unreadable while the phone is locked, so a background
/// launch (a push, a scene coming back before the passcode) read "no token"
/// and the partner landed on the login screen. Items saved before this
/// change are migrated the first time they are read.
enum Keychain {
  private static let service = "com.jyt.partner-mobile"
  private static let account = "partner_jwt"
  private static let accessibility = kSecAttrAccessibleAfterFirstUnlock

  private static var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  static func saveToken(_ token: String) {
    let query = baseQuery
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = Data(token.utf8)
    add[kSecAttrAccessible as String] = accessibility
    SecItemAdd(add as CFDictionary, nil)
  }

  static func loadToken() -> String? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess,
          let item = result as? [String: Any],
          let data = item[kSecValueData as String] as? Data,
          let token = String(data: data, encoding: .utf8) else { return nil }

    // Migrate a token saved before kSecAttrAccessible was set: re-save it
    // with the after-first-unlock class.
    let current = item[kSecAttrAccessible as String] as? String
    if current != (accessibility as String) {
      saveToken(token)
    }
    return token
  }

  static func clearToken() {
    SecItemDelete(baseQuery as CFDictionary)
  }
}
