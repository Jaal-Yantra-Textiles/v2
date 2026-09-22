import Foundation

/// App-level configuration. The backend URL defaults to the local dev server
/// and can be overridden via the `PartnerBackendURL` key in Info.plist so a
/// release build can be pointed at staging/prod without a code change.
enum Config {
  static let backendURL: URL = {
    let defaultURL = URL(string: "http://localhost:9000")!
    guard let raw = Bundle.main.object(forInfoDictionaryKey: "PartnerBackendURL") as? String,
          !raw.isEmpty,
          let url = URL(string: raw) else {
      return defaultURL
    }
    return url
  }()
}
