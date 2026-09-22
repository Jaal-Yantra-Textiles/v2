import Foundation

/// The partner API client — the Swift counterpart of the partner-ui hooks
/// (`apps/partner-ui/src/hooks/api/*`). All requests run against the
/// `/partners/*` surface with the JWT from the Keychain.
actor PartnerAPI {
  static let shared = PartnerAPI()

  private let decoder: JSONDecoder
  private let session: URLSession

  private init() {
    let d = JSONDecoder()
    // ISO 8601 (Medusa's own timestamps) or JS `Date.toString()`. The design
    // routes emit partner_started/finished/completed through
    // `String(new Date(...))` — "Wed Sep 23 2026 09:18:09 GMT+1000
    // (Australian Eastern Standard Time)" — server-locale formatted, so
    // parse it on its own terms (designs/[designId]/route.ts:216).
    d.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let raw = try container.decode(String.self)
      for formatter in [ISO8601DateFormatter.fractional, ISO8601DateFormatter.standard] {
        if let date = formatter.date(from: raw) {
          return date
        }
      }
      if let date = Self.parseJavaScriptDate(raw) {
        return date
      }
      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Unparseable date: \(raw)")
    }
    self.decoder = d
    self.session = URLSession(configuration: .ephemeral)
  }

  /// JS `Date.toString()` — strip the trailing "(Timezone Name)" and parse
  /// "EEE MMM dd yyyy HH:mm:ss 'GMT'Z" with a POSIX locale.
  static let jsDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "EEE MMM dd yyyy HH:mm:ss 'GMT'Z"
    return f
  }()

  static func parseJavaScriptDate(_ raw: String) -> Date? {
    var candidate = raw
    if let paren = raw.range(of: " (") {
      candidate = String(raw[..<paren.lowerBound])
    }
    return jsDateFormatter.date(from: candidate)
  }

  // MARK: - Requests

  /// POST /auth/partner/emailpass — raw login so an unverified email
  /// surfaces as `verificationRequired` instead of an opaque 401.
  struct LoginOutcome {
    let verificationRequired: Bool
    let email: String
  }

  func login(email: String, password: String) async throws -> LoginOutcome {
    let body: [String: String] = ["email": email, "password": password]
    var request = URLRequest(url: Self.makeURL("auth/partner/emailpass"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (data, response) = try await session.data(for: request)
    try Self.check(response, data: data)

    let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    if parsed?["verification_required"] as? Bool == true {
      return LoginOutcome(verificationRequired: true, email: email)
    }

    guard let token = parsed?["token"] as? String
            ?? (parsed?["access_token"] as? String) else {
      throw PartnerError.invalidResponse
    }
    Keychain.saveToken(token)
    return LoginOutcome(verificationRequired: false, email: email)
  }

  nonisolated func logout() {
    Keychain.clearToken()
  }

  func me() async throws -> PartnerMe {
    try await get(path: "partners/me")
  }

  func orders(
    kind: String = "design",
    limit: Int = 20,
    offset: Int = 0,
    query: String? = nil
  ) async throws -> PartnerOrderListResponse {
    var path = "partners/orders?kind=\(kind)&limit=\(limit)&offset=\(offset)"
    if let query, !query.isEmpty {
      let encoded = query.addingPercentEncoding(
        withAllowedCharacters: .urlQueryAllowed) ?? query
      path += "&q=\(encoded)"
    }
    return try await get(path: path)
  }

  func order(id: String) async throws -> PartnerOrder {
    struct Wrapper: Codable { let order: PartnerOrder }
    let wrapper: Wrapper = try await get(path: "partners/orders/\(id)")
    return wrapper.order
  }

  // MARK: - Designs & production runs

  func designs(limit: Int = 20, offset: Int = 0, query: String? = nil) async throws -> PartnerDesignListResponse {
    var path = "partners/designs?limit=\(limit)&offset=\(offset)"
    if let query, !query.isEmpty {
      path += "&q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)"
    }
    return try await get(path: path)
  }

  func design(id: String) async throws -> DesignDetail {
    struct Wrapper: Codable { let design: DesignDetail }
    let wrapper: Wrapper = try await get(path: "partners/designs/\(id)")
    return wrapper.design
  }

  func productionRuns(designId: String? = nil, limit: Int = 20, offset: Int = 0) async throws -> ProductionRunListResponse {
    var path = "partners/production-runs?limit=\(limit)&offset=\(offset)"
    if let designId {
      path += "&design_id=\(designId)"
    }
    return try await get(path: path)
  }

  func productionRun(id: String) async throws -> ProductionRunDetail {
    try await get(path: "partners/production-runs/\(id)")
  }

  // MARK: - Run lifecycle actions
  // POST /partners/production-runs/:id/{accept,start,finish,complete} —
  // the same mutations the partner-ui milestone hooks wrap
  // (apps/partner-ui/src/hooks/api/partner-production-runs.tsx:128).

  func acceptRun(id: String) async throws {
    try await post(path: "partners/production-runs/\(id)/accept")
  }

  func startRun(id: String) async throws {
    try await post(path: "partners/production-runs/\(id)/start")
  }

  /// `finish` takes an optional notes field (the FinishRunForm's textarea).
  func finishRun(id: String, notes: String?) async throws {
    struct Body: Codable { let notes: String? }
    try await post(
      path: "partners/production-runs/\(id)/finish",
      json: try JSONEncoder().encode(Body(notes: notes))
    )
  }

  /// `complete` output + cost — the CompleteRunForm essentials. The web form
  /// also logs consumptions; those stay on the consumption surfaces, and the
  /// backend accepts a completion without them.
  struct ConsumptionEntry: Codable {
    var inventory_item_id: String?
    var quantity: Double
    var unit_cost: Double?
    var unit_of_measure: String?
    var consumption_type: String?
    var notes: String?
  }

  struct CompleteRunBody: Codable {
    var produced_quantity: Int?
    var rejected_quantity: Int?
    var rejection_reason: String?
    var rejection_notes: String?
    var partner_cost_estimate: Double?
    var cost_type: String?
    var allow_shortfall: Bool?
    var notes: String?
    var consumptions: [ConsumptionEntry]?
  }

  func completeRun(id: String, body: CompleteRunBody) async throws {
    try await post(
      path: "partners/production-runs/\(id)/complete",
      json: try JSONEncoder().encode(body)
    )
  }

  // MARK: - Media upload
  // POST /partners/production-runs/:id/media (multipart `files`) uploads to
  // the storage provider; .../media/attach then merges the URLs into the
  // design's media_files. Same two-step the partner-ui runs.

  struct MediaPart {
    let filename: String
    let mimeType: String
    let data: Data
  }

  func uploadRunMedia(
    runId: String,
    parts: [MediaPart]
  ) async throws -> [UploadedFile] {
    let boundary = "JYTPartnerBoundary-\(UUID().uuidString)"
    var request = URLRequest(url: Self.makeURL("partners/production-runs/\(runId)/media"))
    request.httpMethod = "POST"
    request.setValue(
      "multipart/form-data; boundary=\(boundary)",
      forHTTPHeaderField: "Content-Type"
    )
    if let token = Keychain.loadToken() {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    request.httpBody = Self.multipartBody(boundary: boundary, parts: parts)

    let (data, response) = try await session.data(for: request)
    try Self.check(response, data: data)
    do {
      let decoded = try decoder.decode(UploadFilesResponse.self, from: data)
      return decoded.files
    } catch let error as DecodingError {
      throw PartnerError.decoding(Self.summarize(error))
    } catch {
      throw PartnerError.invalidResponse
    }
  }

  /// Attach freshly uploaded files to the run's design (isThumbnail left
  /// unset — the flagged thumbnail is chosen elsewhere, like the web).
  func attachRunMedia(runId: String, files: [UploadedFile]) async throws {
    let body = AttachMediaBody(
      media_files: files.map { AttachMediaFile(id: $0.id, url: $0.url, isThumbnail: nil) }
    )
    try await post(
      path: "partners/production-runs/\(runId)/media/attach",
      json: try JSONEncoder().encode(body)
    )
  }

  static func multipartBody(boundary: String, parts: [MediaPart]) -> Data {
    var body = Data()
    let line = { (s: String) in body.append(Data(s.utf8)) }
    for part in parts {
      line("--\(boundary)\r\n")
      line("Content-Disposition: form-data; name=\"files\"; filename=\"\(part.filename)\"\r\n")
      line("Content-Type: \(part.mimeType)\r\n\r\n")
      body.append(part.data)
      line("\r\n")
    }
    line("--\(boundary)--\r\n")
    return body
  }

  private func post(path: String, json: Data? = nil) async throws {
    var request = URLRequest(url: Self.makeURL(path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token = Keychain.loadToken() {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    if let json {
      request.httpBody = json
    }
    let (data, response) = try await session.data(for: request)
    try Self.check(response, data: data)
  }

  // MARK: - Plumbing

  /// Build a request URL from "path" or "path?query".
  ///
  /// `URL.appending(path:)` must NOT be used here: it percent-encodes the
  /// `?` of a query string (`orders%3Fkind=design`), turning every
  /// parameterised request into a 404. Path and query are separated
  /// explicitly and set through URLComponents instead.
  static func makeURL(_ path: String) -> URL {
    var components = URLComponents()
    components.scheme = Config.backendURL.scheme
    components.host = Config.backendURL.host
    components.port = Config.backendURL.port

    if let questionMark = path.firstIndex(of: "?") {
      components.path =
        Config.backendURL.path + "/" + String(path[..<questionMark])
      components.query = String(path[path.index(after: questionMark)...])
    } else {
      components.path = Config.backendURL.path + "/" + path
    }
    return components.url ?? Config.backendURL
  }

  private func get<T: Decodable>(path: String) async throws -> T {
    var request = URLRequest(url: Self.makeURL(path))
    request.httpMethod = "GET"
    if let token = Keychain.loadToken() {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    let (data, response) = try await session.data(for: request)
    try Self.check(response, data: data)
    do {
      return try decoder.decode(T.self, from: data)
    } catch let error as DecodingError {
      throw PartnerError.decoding(Self.summarize(error))
    } catch {
      throw PartnerError.invalidResponse
    }
  }

  /// A one-line digest of a decoding failure — keyPath + reason, enough to
  /// name the offending field without dumping the whole context.
  static func summarize(_ error: DecodingError) -> String {
    switch error {
    case .keyNotFound(let key, let context):
      return "missing \(key.stringValue) in \(context.debugDescription.split(separator: " from ").first ?? "")"
    case .typeMismatch(let type, let context):
      return "expected \(type) at \(context.codingPath.map(\.stringValue).joined(separator: "."))"
    case .dataCorrupted(let context):
      let path = context.codingPath.map(\.stringValue).joined(separator: ".")
      return "corrupted value at \(path): \(context.debugDescription.prefix(80))"
    case .valueNotFound(let type, let context):
      return "null \(type) at \(context.codingPath.map(\.stringValue).joined(separator: "."))"
    @unknown default:
      return String(describing: error).prefix(120).description
    }
  }

  private static func check(_ response: URLResponse, data: Data) throws {
    guard let http = response as? HTTPURLResponse else {
      throw PartnerError.invalidResponse
    }
    guard !(200...299).contains(http.statusCode) else { return }
    var message = ""
    if let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let msg = parsed["message"] as? String {
      message = msg
    } else if let s = String(data: data, encoding: .utf8), s.count < 300 {
      message = s
    }
    throw PartnerError.http(status: http.statusCode, message: message)
  }
}

private extension ISO8601DateFormatter {
  static let standard: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
  }()

  static let fractional: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
}
