/**
 * Re-exported from `service-types.ts`, which now carries all SIX values the
 * live account offers rather than the two the sandbox did. Kept exported from
 * here so existing imports keep working.
 */
export type { DtdcServiceType } from "./service-types"
import type { DtdcServiceType } from "./service-types"

export type DtdcLoadType = "NON-DOCUMENT" | "DOCUMENT"

export type DtdcConsignmentType = "Forward" | "Reverse"

export type DtdcPaymentMode = "prepaid" | "cod"

export type DtdcOptions = {
  customer_code: string
  api_key: string
  sandbox?: boolean
  tracking_username?: string
  tracking_password?: string
  tracking_access_token?: string
  default_service_type?: DtdcServiceType
  /**
   * What the parcels contain, as a DTDC commodity id or one of the names in
   * `commodities.ts` (e.g. "38" or "CLOTHING").
   *
   * 🔴 Set this. The wire default was `"2"` — MOBILE — so every waybill booked
   * without it declared a mobile phone. See `commodities.ts`.
   */
  default_commodity_id?: string
  fetchImpl?: DtdcFetchLike
}

export type DtdcFetchLike = (
  input: string,
  init?: Record<string, any>
) => Promise<any>

export type DtdcAddress = {
  name: string
  phone: string
  alternate_phone?: string
  address_line_1: string
  address_line_2?: string
  pincode: string
  city: string
  state: string
  country?: string
  email?: string
}

export type DtdcConsignmentInput = {
  customer_code: string
  service_type_id: DtdcServiceType
  load_type: DtdcLoadType
  consignment_type: DtdcConsignmentType
  dimension_unit: string
  length: string
  width: string
  height: string
  weight_unit: string
  weight: string
  declared_value: string
  eway_bill?: string
  invoice_number?: string
  invoice_date?: string
  num_pieces: string
  origin_details: DtdcAddress
  destination_details: DtdcAddress
  return_details?: DtdcAddress
  customer_reference_number: string
  cod_collection_mode?: string
  cod_amount?: string
  commodity_id?: string
  description?: string
  reference_number?: string
}

export type DtdcBookingRequest = {
  consignments: DtdcConsignmentInput[]
}

/**
 * One entry in a booking response's `data` array. On success `success` is
 * `true` and `reference_number` carries the DTDC AWB; on failure `success` is
 * `false` with the reason in `message` / `reason`.
 */
export type DtdcBookingResponseEntry = {
  success: boolean
  reference_number?: string
  reason?: string
  message?: string
  customer_reference_number?: string
  chargeable_weight?: number
  pieces?: Array<{ reference_number?: string; product_code?: string }>
  [key: string]: any
}

export type DtdcBookingResponse = {
  status?: string
  data?: DtdcBookingResponseEntry[]
  [key: string]: any
}

export type DtdcCancelRequest = {
  AWBNo: string[]
  customerCode: string
}

export type DtdcCancelFailure = {
  message?: string
  reason?: string
  reference_number?: string
  code?: string
  [key: string]: any
}

export type DtdcCancelResponse = {
  status?: string
  success?: boolean
  failures?: DtdcCancelFailure[]
  successConsignments?: any[]
  [key: string]: any
}

/**
 * The pincode (rate calculator) response. `ZIPCODE_RESP[0].SERV_COD` is `"Y"`
 * for serviceable pincodes; `SERV_LIST[0].b2C_SERVICEABLE` is `"YES"` when the
 * B2C product serves the lane. `SERV_LIST_DTLS` lists the service codes and TAT.
 */
export type DtdcPincodeResponse = {
  ZIPCODE_RESP?: Array<{
    MESSAGE?: string
    ORGPIN?: string
    DESTPIN?: string
    DESTCITY?: string
    DESTSTATE?: string
    SERV_COD?: string
    SERVFLAG?: string
  }>
  SERV_LIST?: Array<{
    b2C_SERVICEABLE?: string
    b2C_COD_Serviceable?: string
    COD_Serviceable?: string
    b2B_SERVICEABLE?: string
  }>
  SERV_LIST_DTLS?: Array<{ CODE?: string; TAT?: string; NAME?: string }>
  PIN_CITY?: Array<{ PIN?: string; CITY?: string; STATE_NAME?: string }>
  [key: string]: any
}

export type DtdcTrackingHeader = {
  strShipmentNo?: string
  strRefNo?: string
  strCNProduct?: string
  strStatus?: string
  strOrigin?: string
  strDestination?: string
  strWeight?: string
  strPieces?: string
  strBookedDate?: string
  strExpectedDeliveryDate?: string
  [key: string]: any
}

export type DtdcTrackingEvent = {
  strCode?: string
  strAction?: string
  strOrigin?: string
  strDestination?: string
  strActionDate?: string
  strActionTime?: string
  sTrRemarks?: string
  [key: string]: any
}

export type DtdcTrackingResponse = {
  statusCode?: number
  statusFlag?: boolean
  status?: string
  trackHeader?: DtdcTrackingHeader
  trackDetails?: DtdcTrackingEvent[]
  errorDetails?: any
  [key: string]: any
}

export type DtdcTrackingRequest = {
  trkType: string
  strcnno: string
  addtnlDtl: string
}