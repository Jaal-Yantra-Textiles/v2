import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import ExcelJS from "exceljs"
import { randomBytes } from "crypto"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type ImportTourBookingsInput = {
  form_id: string
  // Pre-parsed bookings from the GYG xlsx (parsed in the route handler so we
  // don't have to send a Buffer through the workflow serializer).
  bookings: GygBooking[]
  // Days the visit token stays valid past the tour date.
  token_ttl_days?: number
}

const HEADCOUNT_KEYS = [
  "Adult",
  "Senior",
  "Student (with ID)",
  "EU citizens (with ID)",
  "Student EU citizens (with ID)",
  "Military (with ID)",
  "Youth",
  "Child",
  "Infant",
] as const

export type GygBooking = {
  booking_ref: string
  supplier_ref: string | null
  product: string | null
  option: string | null
  // ISO 8601 strings so the value survives workflow input serialization.
  tour_date: string
  purchase_date: string | null
  email: string | null
  phone: string | null
  first_name: string | null
  surname: string | null
  city: string | null
  country: string | null
  language: string | null
  add_ons: string | null
  group: string | null
  price: string | null
  net_price: string | null
  reseller_information: string | null
  rnpl: boolean
  headcount: Record<string, number>
}

const cellString = (v: ExcelJS.CellValue): string | null => {
  if (v == null) return null
  if (typeof v === "string") return v.trim() || null
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "object" && "text" in (v as any)) {
    const t = (v as any).text
    return typeof t === "string" ? t.trim() || null : null
  }
  if (typeof v === "object" && "result" in (v as any)) {
    return cellString((v as any).result)
  }
  return null
}

const cellNumber = (v: ExcelJS.CellValue): number => {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

const cellDate = (v: ExcelJS.CellValue): Date | null => {
  if (v instanceof Date) return v
  if (typeof v === "string") {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

export async function parseGygWorkbook(buffer: Buffer): Promise<GygBooking[]> {
  const wb = new ExcelJS.Workbook()
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  )
  await wb.xlsx.load(arrayBuffer as ArrayBuffer)

  const bookings: GygBooking[] = []

  wb.eachSheet((sheet) => {
    const headerRow = sheet.getRow(1)
    const header: string[] = []
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      header[col] = String(cellString(cell.value) ?? "")
    })

    const idx = (name: string) => header.findIndex((h) => h === name)
    const get = (row: ExcelJS.Row, name: string) => {
      const i = idx(name)
      return i > 0 ? row.getCell(i).value : null
    }

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return // header
      const bookingRef = cellString(get(row, "Booking Ref No."))
      if (!bookingRef) return // skip empty rows

      const tourDate = cellDate(get(row, "Date"))
      if (!tourDate) return // tours without a date are noise

      const headcount: Record<string, number> = {}
      for (const k of HEADCOUNT_KEYS) {
        const n = cellNumber(get(row, k))
        if (n) headcount[k] = n
      }
      // "Group" column isn't a count category but a flag; preserve as string
      // alongside.

      const purchaseDate =
        cellDate(get(row, "Purchase Date (local time)")) ??
        cellDate(get(row, "Purchase Date (Berlin time)"))
      bookings.push({
        booking_ref: bookingRef,
        supplier_ref: cellString(get(row, "Supplier Ref No.")),
        product: cellString(get(row, "Product")),
        option: cellString(get(row, "Option")),
        tour_date: tourDate.toISOString(),
        purchase_date: purchaseDate ? purchaseDate.toISOString() : null,
        email: cellString(get(row, "Email")),
        phone: cellString(get(row, "Phone")),
        first_name: cellString(get(row, "Traveller's First Name")),
        surname: cellString(get(row, "Traveller's Surname")),
        city: cellString(get(row, "Traveller's City")),
        country: cellString(get(row, "Traveller's Country")),
        language: cellString(get(row, "Language")),
        add_ons: cellString(get(row, "Add-ons")),
        group: cellString(get(row, "Group")),
        price: cellString(get(row, "Price")),
        net_price: cellString(get(row, "Net Price")),
        reseller_information: cellString(get(row, "Reseller Information")),
        rnpl:
          (cellString(get(row, "Reserve Now, Pay Later Booking")) || "").toLowerCase() ===
          "yes",
        headcount,
      })
    })
  })

  return bookings
}

const mintToken = (): string =>
  randomBytes(32).toString("base64url")

const importTourBookingsStep = createStep(
  "import-tour-bookings",
  async (input: ImportTourBookingsInput, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)

    const form = await forms.retrieveForm(input.form_id).catch(() => null)
    if (!form) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Form ${input.form_id} not found`
      )
    }
    if ((form as any).type !== "tour") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Form ${input.form_id} is not a tour form (type=${(form as any).type})`
      )
    }

    const bookings = input.bookings

    // Pull existing responses for this form, dedup by booking_ref to keep
    // re-imports idempotent.
    const existing = await forms.listFormResponses(
      { form_id: input.form_id },
      { take: 10000 }
    )
    const existingByRef = new Map<string, any>()
    for (const r of existing) {
      const ref = (r.metadata as any)?.gyg?.booking_ref
      if (ref) existingByRef.set(ref, r)
    }

    const ttlDays = input.token_ttl_days ?? 60
    const created: any[] = []
    const skipped: string[] = []

    for (const b of bookings) {
      if (existingByRef.has(b.booking_ref)) {
        skipped.push(b.booking_ref)
        continue
      }

      const tourDate = new Date(b.tour_date)
      const purchaseDate = b.purchase_date ? new Date(b.purchase_date) : null
      const expires = new Date(tourDate)
      expires.setUTCDate(expires.getUTCDate() + ttlDays)

      const response = await forms.createFormResponses({
        form_id: input.form_id,
        status: "pending_verification",
        email: b.email,
        data: {},
        submitted_at: purchaseDate ?? new Date(),
        verification_code: mintToken(),
        verification_expires_at: expires,
        metadata: {
          source: "gyg",
          gyg: {
            booking_ref: b.booking_ref,
            supplier_ref: b.supplier_ref,
            product: b.product,
            option: b.option,
            tour_date: b.tour_date,
            purchase_date: b.purchase_date,
            traveller: {
              first_name: b.first_name,
              surname: b.surname,
              email: b.email,
              phone: b.phone,
              city: b.city,
              country: b.country,
              language: b.language,
            },
            headcount: b.headcount,
            add_ons: b.add_ons,
            group: b.group,
            price: b.price,
            net_price: b.net_price,
            reseller_information: b.reseller_information,
            rnpl: b.rnpl,
          },
        },
      })

      created.push(response)
    }

    return new StepResponse(
      {
        created_count: created.length,
        skipped_count: skipped.length,
        skipped_booking_refs: skipped,
        responses: created,
      },
      created.map((r) => r.id)
    )
  },
  async (responseIds: string[], { container }) => {
    if (!responseIds?.length) return
    const forms: FormsService = container.resolve(FORMS_MODULE)
    await forms.softDeleteFormResponses(responseIds)
  }
)

export const importTourBookingsWorkflow = createWorkflow(
  "import-tour-bookings",
  (input: ImportTourBookingsInput) => {
    const result = importTourBookingsStep(input)
    return new WorkflowResponse(result)
  }
)
