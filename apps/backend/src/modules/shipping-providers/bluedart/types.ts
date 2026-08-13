/** Layer-2 credentials — travel in the request BODY, not the headers. */
export type BlueDartProfile = {
  Api_type: string
  Customercode: string
  LicenceKey: string
  LoginID: string
  Version: string
}

export type BlueDartConfig = {
  /** Layer-1 gateway credentials, used only to mint the JWT. */
  client_id: string
  client_secret: string
  /** Layer-2 shipping account. */
  login_id: string
  licence_key: string
  customer_code: string
  api_type?: string
  version?: string
  /** Origin area code, e.g. "DHM" for Dharamshala. */
  origin_area?: string
  /**
   * Tracking uses a DIFFERENT licence key from shipping. Probed live on
   * 2026-08-13: the shipping key returns `{"ShipmentData":{"Error":"License
   * Mismatch"}}` against the tracking endpoint. Defaults to the shipping key so
   * the call is at least attempted and fails with a nameable reason.
   */
  tracking_licence_key?: string
  sandbox?: boolean
  /** Injected transport for tests — the live API mints billable waybills. */
  fetchImpl?: typeof fetch
}

/** Status entries Blue Dart returns on nearly every result envelope. */
export type BlueDartStatus = {
  StatusCode?: string
  StatusInformation?: string
}

export type BlueDartWaybillResult = {
  AWBNo?: string
  Status?: BlueDartStatus[]
  AvailableBalance?: number
  TransactionAmount?: number
  DestinationArea?: string
  IsError?: boolean
  MPSDetails?: Array<{ MPSNumber?: string }>
}

export type BlueDartCancelResult = {
  AWBNo?: string
  IsError?: boolean
  Status?: BlueDartStatus[]
}

export type BlueDartPickupResult = {
  IsError?: boolean
  TokenNumber?: string
  Status?: BlueDartStatus[]
  ShipmentPickupDate?: string
}

export type BlueDartServiceabilityResult = {
  AreaCode?: string
  CityDescription?: string
  Region?: string
  IsError?: boolean
  Status?: BlueDartStatus[]
  /** Product availability flags, e.g. `DomesticPriorityOutbound: "Yes"`. */
  [flag: string]: any
}
