import {
  BLUEDART_BASE_URL,
  BLUEDART_PATHS,
  BLUEDART_SANDBOX_URL,
} from "./constants"
import type {
  BlueDartCancelResult,
  BlueDartConfig,
  BlueDartPickupResult,
  BlueDartProfile,
  BlueDartServiceabilityResult,
  BlueDartStatus,
  BlueDartWaybillResult,
} from "./types"

/**
 * Raw Blue Dart HTTP client — token lifecycle, envelope unwrapping, and turning
 * their several ways of saying "no" into one thrown error.
 *
 * The adapter above this maps our carrier-agnostic shapes onto it; this file
 * knows only Blue Dart.
 */

export class BlueDartApiError extends Error {
  readonly statusCodes: string[]
  readonly raw: any
  constructor(message: string, statusCodes: string[] = [], raw?: any) {
    super(message)
    this.name = "BlueDartApiError"
    this.statusCodes = statusCodes
    this.raw = raw
  }
}

/**
 * Blue Dart reports failure three different ways and a caller must treat all
 * three as failure: an `IsError: true` flag, a `Status[]` whose codes are not
 * `Valid`/`InsertSuccess`, or an `Error` string on the payload. A 200 means the
 * request was well-formed, nothing more.
 */
export function describeBlueDartFailure(result: any): string | null {
  if (!result || typeof result !== "object") return null
  if (typeof result.Error === "string" && result.Error.trim()) {
    return result.Error.trim()
  }
  const statuses: BlueDartStatus[] = Array.isArray(result.Status)
    ? result.Status
    : []
  const informative = statuses
    .map((s) => s?.StatusInformation || s?.StatusCode)
    .filter(Boolean)
    .join("; ")
  const OK = new Set(["valid", "insertsuccess", "success"])
  const anyBadStatus =
    statuses.length > 0 &&
    !statuses.some((s) => OK.has(String(s?.StatusCode || "").toLowerCase()))

  if (result.IsError === true || anyBadStatus) {
    return informative || "Blue Dart rejected the request"
  }
  return null
}

/**
 * Turn an HTTP-error body into one readable line.
 *
 * A rejected Blue Dart request is NOT the silent 400 this integration has long
 * assumed. The gateway answers with a precise reason:
 *
 *   {"status":400,"title":"Bad Request",
 *    "error-response":[{"StatusCode":"InvalidPinCode",
 *                      "StatusInformation":"Pincode cannot be blank "}]}
 *
 * ...but it arrives pretty-printed and LEADING WITH NEWLINES, so a logger that
 * keeps only the first line of an error message shows `failed (400): ` and
 * nothing else. That apparent silence sent three separate sessions hunting auth
 * and path faults for what the carrier had already named. Collapse it onto one
 * line so the reason survives the log.
 */
export function describeBlueDartHttpError(body: string): string {
  const raw = String(body || "").trim()
  if (!raw) return "(empty body)"
  try {
    const json = JSON.parse(raw)
    const errors = Array.isArray(json?.["error-response"])
      ? json["error-response"]
      : []
    const described = errors
      .map((e: any) =>
        [e?.StatusCode, String(e?.StatusInformation || "").trim()]
          .filter(Boolean)
          .join(": ")
      )
      .filter(Boolean)
      .join("; ")
    if (described) return described
  } catch {
    // Not JSON — fall through and return the flattened text.
  }
  return raw.replace(/\s+/g, " ").slice(0, 300)
}

/** The `StatusCode`s from an HTTP-error body, for programmatic handling. */
export function blueDartHttpErrorCodes(body: string): string[] {
  try {
    const json = JSON.parse(String(body || ""))
    const errors = Array.isArray(json?.["error-response"])
      ? json["error-response"]
      : []
    return errors.map((e: any) => e?.StatusCode).filter(Boolean)
  } catch {
    return []
  }
}

export class BlueDartClient {
  readonly carrier = "bluedart"
  private readonly baseUrl: string
  private readonly cfg: BlueDartConfig
  private readonly fetchImpl: typeof fetch
  private cachedToken: string | null = null
  private tokenExpiry = 0

  constructor(cfg: BlueDartConfig) {
    this.cfg = cfg
    this.baseUrl = cfg.sandbox ? BLUEDART_SANDBOX_URL : BLUEDART_BASE_URL
    this.fetchImpl = cfg.fetchImpl || fetch
  }

  /** Layer-2 credentials. `Customercode` AND `Version` are both mandatory — omitting
   *  either yields "UnauthorizedUser" or a null-reference error, not a clear message. */
  get profile(): BlueDartProfile {
    return {
      Api_type: this.cfg.api_type || "S",
      Customercode: this.cfg.customer_code,
      LicenceKey: this.cfg.licence_key,
      LoginID: this.cfg.login_id,
      Version: this.cfg.version || "1.3",
    }
  }

  get originArea(): string {
    return this.cfg.origin_area || "DHM"
  }

  /**
   * Mint (and cache) the gateway JWT. Valid 24 h; refreshed 5 min early.
   *
   * Cached in memory only, and never logged — it is a bearer credential for an
   * account with a real balance behind it.
   */
  async getToken(now: number = Date.now()): Promise<string> {
    if (this.cachedToken && now < this.tokenExpiry) return this.cachedToken

    const res = await this.fetchImpl(`${this.baseUrl}${BLUEDART_PATHS.token}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        clientID: this.cfg.client_id,
        clientSecret: this.cfg.client_secret,
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new BlueDartApiError(
        `Blue Dart token request failed (${res.status}): ${body.slice(0, 300)}`
      )
    }
    const json: any = await res.json()
    const token = json?.JWTToken
    if (!token) {
      throw new BlueDartApiError(
        "Blue Dart token response carried no JWTToken",
        [],
        json
      )
    }
    this.cachedToken = token
    this.tokenExpiry = now + 24 * 60 * 60 * 1000 - 5 * 60 * 1000
    return token
  }

  /** POST a JSON body with the JWT header. NOT `Authorization: Bearer` — Blue Dart
   *  reads a bare `JWTToken` header and ignores anything else. */
  private async post<T>(path: string, body: any): Promise<T> {
    const token = await this.getToken()
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        JWTToken: token,
      },
      body: JSON.stringify(body),
    })
    const text = await res.text().catch(() => "")
    if (!res.ok) {
      throw new BlueDartApiError(
        `Blue Dart ${path} failed (${res.status}): ${describeBlueDartHttpError(text)}`,
        blueDartHttpErrorCodes(text)
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new BlueDartApiError(
        `Blue Dart ${path} returned a non-JSON body: ${text.slice(0, 200)}`
      )
    }
  }

  /** Unwrap a `<Name>Result` envelope and throw on any of the failure shapes. */
  private unwrap<T>(json: any, key: string): T {
    const result = json?.[key] ?? json
    const failure = describeBlueDartFailure(result)
    if (failure) {
      const codes = (Array.isArray(result?.Status) ? result.Status : [])
        .map((s: BlueDartStatus) => s?.StatusCode)
        .filter(Boolean)
      throw new BlueDartApiError(`Blue Dart: ${failure}`, codes, result)
    }
    return result as T
  }

  async checkServiceability(
    pincode: string
  ): Promise<BlueDartServiceabilityResult> {
    // This call takes a REDUCED profile — no Customercode, no Version. Sending
    // the full one is accepted, but the documented shape is this.
    const json = await this.post<any>(BLUEDART_PATHS.servicesForPincode, {
      pinCode: String(pincode),
      profile: {
        Api_type: this.profile.Api_type,
        LicenceKey: this.profile.LicenceKey,
        LoginID: this.profile.LoginID,
      },
    })
    return this.unwrap<BlueDartServiceabilityResult>(
      json,
      "GetServicesforPincodeResult"
    )
  }

  async generateWaybill(request: any): Promise<BlueDartWaybillResult> {
    const json = await this.post<any>(BLUEDART_PATHS.generateWaybill, {
      Request: request,
      Profile: this.profile,
    })
    return this.unwrap<BlueDartWaybillResult>(json, "GenerateWayBillResult")
  }

  async cancelWaybill(awbNo: string): Promise<BlueDartCancelResult> {
    const json = await this.post<any>(BLUEDART_PATHS.cancelWaybill, {
      Request: { AWBNo: String(awbNo) },
      Profile: this.profile,
    })
    return this.unwrap<BlueDartCancelResult>(json, "CancelWaybillResult")
  }

  async registerPickup(request: any): Promise<BlueDartPickupResult> {
    // Note the lowercase `request` / `profile` keys here — the pickup API differs
    // from the waybill API's capitalised `Request` / `Profile`, and swapping them
    // yields an unhelpful null-reference error rather than a validation message.
    const json = await this.post<any>(BLUEDART_PATHS.registerPickup, {
      request,
      profile: this.profile,
    })
    return this.unwrap<BlueDartPickupResult>(json, "RegisterPickupResult")
  }

  /**
   * Verified live 2026-08-13 against two real pickup tokens — both cancelled
   * with `{"StatusCode":"CancelSuccess"}`, and a repeat call correctly returns
   * `PickupAlreadyCancelled`.
   *
   *  - `TokenNumber` is a NUMBER in the spec, not a string.
   *  - `Remarks` rejects non-alphanumerics: an em dash returns "Invalid value in
   *    Remarks parameter". Keep it plain ASCII.
   *  - `PickupRegistrationDate` must be the date the pickup was booked FOR, in
   *    Microsoft-JSON form. It is part of the lookup key, not decoration.
   */
  async cancelPickup(tokenNumber: string, pickupDate: string): Promise<any> {
    const numeric = Number(tokenNumber)
    const json = await this.post<any>(BLUEDART_PATHS.cancelPickup, {
      request: {
        TokenNumber: Number.isFinite(numeric) ? numeric : String(tokenNumber),
        PickupRegistrationDate: pickupDate,
        Remarks: "Cancelled from Jaal Yantra admin",
      },
      profile: this.profile,
    })
    return this.unwrap<any>(json, "CancelPickupResult")
  }

  /**
   * Track one or more AWBs.
   *
   * ⚠️⚠️ **NEVER send `verno` here.** The shipping licence key IS the tracking
   * licence key — but TnT folds `verno` into its licence check, so *any* value
   * (`1`, `1.3`, anything) comes back
   * `{"ShipmentData":{"Error":"License Mismatch"}}`. That error names the wrong
   * culprit and cost a full session: it was read as "tracking needs a second
   * credential Blue Dart never issued us", and a 30-combination probe matrix
   * "confirmed" it — every cell carried `verno`, so every cell failed for the
   * one reason baked into all of them. Drop `verno` and the same key
   * authenticates. `verno` is a SHIPPING-API parameter; it has no business on
   * this endpoint, which is why the published spec's example is the only place
   * it appears.
   *
   * `awb=awb` is a mode selector, not the number — the number rides in
   * `numbers`. `scan` is required (`1` = full scan detail, `0` = status only);
   * dropping it makes the gateway reject with a 400 "Request validation error"
   * before the tracking app ever sees it.
   *
   * `tracking_licence_key` (env `BLUE_DART_TRACKING_LICENCE_KEY`) remains an
   * optional override for the day Blue Dart splits the licences for real. It is
   * NOT required, and leaving it unset is the normal case.
   */
  async trackShipment(awbNumbers: string | string[]): Promise<any> {
    const numbers = (Array.isArray(awbNumbers) ? awbNumbers : [awbNumbers]).join(
      ","
    )
    const params = new URLSearchParams({
      handler: "tnt",
      action: "custawbquery",
      loginid: this.cfg.login_id,
      awb: "awb",
      numbers,
      format: "json",
      lickey: this.cfg.tracking_licence_key || this.cfg.licence_key,
      scan: "1",
    })
    const token = await this.getToken()
    const res = await this.fetchImpl(
      `${this.baseUrl}${BLUEDART_PATHS.tracking}?${params.toString()}`,
      { method: "GET", headers: { JWTToken: token } }
    )
    const text = await res.text().catch(() => "")
    if (!res.ok) {
      throw new BlueDartApiError(
        `Blue Dart tracking failed (${res.status}): ${text.slice(0, 300)}`
      )
    }
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      throw new BlueDartApiError(
        `Blue Dart tracking returned a non-JSON body: ${text.slice(0, 200)}`
      )
    }
    const shipmentData = json?.ShipmentData ?? json
    const failure = describeBlueDartFailure(shipmentData)
    if (failure) {
      const hint = /licen[cs]e mismatch/i.test(failure)
        ? " — tracking uses a different licence key from shipping; set BLUE_DART_TRACKING_LICENCE_KEY."
        : ""
      throw new BlueDartApiError(`Blue Dart tracking: ${failure}${hint}`, [], json)
    }
    return json
  }
}
