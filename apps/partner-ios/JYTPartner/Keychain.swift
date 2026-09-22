import Foundation
import Security

/// Minimal iOS Keychain wrapper. A bearer token must never sit in
/// UserDefaults, so the partner JWT lives in the Keychain instead.
enum Keychain {
  private static let service = "com.jyt.partner-mobile"

  static func saveToken(_ token: String) {
    let data = Data(token.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "partner_jwt",
    ]
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = data
    SecItemAdd(add as CFDictionary, nil)
  }

  static func loadToken() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "partner_jwt",
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func clearToken() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "partner_jwt",
    ]
    SecItemDelete(query as CFDictionary)
  }
}
