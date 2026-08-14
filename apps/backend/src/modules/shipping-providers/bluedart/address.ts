/**
 * Fitting an address into Blue Dart's waybill fields.
 *
 * Blue Dart caps EVERY name and address line at 30 characters and restricts the
 * character set, and it does not tell you when you break either rule: an
 * over-long `ConsigneeAddress1` comes back as a bare 400 with an EMPTY body,
 * which names no field and reads like an auth or routing fault. (This is the
 * same class as `Remarks` rejecting an em dash — the gateway validates, then
 * says nothing.)
 *
 * Both real addresses on order 83 exceed the cap: the Dharamshala origin is 40
 * characters and the Gandhinagar destination 43. So this is not an edge case
 * being defended against — it is the normal shape of an Indian street address,
 * and no Blue Dart waybill for that order could ever have been generated
 * without packing them.
 *
 * Per the Blue Dart developer guide, Shipper and Consignee share the limits:
 *   *Name       30, mandatory
 *   *Address1   30, mandatory
 *   *Address2   30, optional
 *   *Address3   30, optional
 *   *Pincode     6, numeric, mandatory
 *   *Mobile  10-15, numeric, optional
 */

/** Max length of a Blue Dart name / address line. */
export const BLUEDART_TEXT_MAX = 30

/**
 * Every field limit the developer guide publishes, checked BEFORE the call.
 *
 * Blue Dart answers a breach with a bare 400 and an empty body — no field name,
 * no reason, indistinguishable from an auth or routing fault. Three separate
 * violations hid behind that same silence on order 83 (blank shipper address,
 * over-long address lines, and a 32-character `CreditReferenceNo`), and each
 * one cost a live round trip to find because the previous fix simply revealed
 * the next.
 *
 * So the limits are asserted locally. A violation now names the field, the cap
 * and the offending value — which is the difference between a five-minute fix
 * and another deploy cycle spent guessing.
 */
type FieldRule = { path: string; max: number; pattern?: RegExp; required?: boolean }

const WAYBILL_RULES: FieldRule[] = [
  { path: "Shipper.CustomerName", max: 30, required: true },
  { path: "Shipper.CustomerAddress1", max: 30, required: true },
  { path: "Shipper.CustomerAddress2", max: 30 },
  { path: "Shipper.CustomerAddress3", max: 30 },
  { path: "Shipper.CustomerPincode", max: 6, pattern: /^\d{6}$/, required: true },
  { path: "Shipper.OriginArea", max: 3, pattern: /^[A-Z]{1,3}$/, required: true },
  { path: "Consignee.ConsigneeName", max: 30, required: true },
  { path: "Consignee.ConsigneeAddress1", max: 30, required: true },
  { path: "Consignee.ConsigneeAddress2", max: 30 },
  { path: "Consignee.ConsigneeAddress3", max: 30 },
  // Domestic only. An export consignee's postcode is not an Indian PIN —
  // Israel's is 7 digits, Ireland's is alphanumeric — so the 6-digit rule is
  // applied conditionally below rather than listed here.
  {
    path: "Services.CreditReferenceNo",
    max: 20,
    pattern: /^[A-Z0-9]{1,20}$/,
    required: true,
  },
  { path: "Services.ProductCode", max: 1, pattern: /^[A-Z]$/, required: true },
  { path: "Services.SubProductCode", max: 1 },
  { path: "Services.SpecialInstruction", max: 50 },
]

const readPath = (obj: any, path: string): any =>
  path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj)

/**
 * Field-limit violations in a waybill request, as human-readable lines. Empty
 * when the request is within spec. Pure, so the whole rule table is testable
 * without a carrier.
 */
export function findBlueDartFieldViolations(
  request: any,
  opts?: { international?: boolean }
): string[] {
  const problems: string[] = []
  const rules: FieldRule[] = [
    ...WAYBILL_RULES,
    opts?.international
      ? // An export postcode has no shared shape across countries; only guard
        // the length so a runaway value still fails locally.
        { path: "Consignee.ConsigneePincode", max: 10, required: true }
      : {
          path: "Consignee.ConsigneePincode",
          max: 6,
          pattern: /^\d{6}$/,
          required: true,
        },
  ]
  for (const rule of rules) {
    const raw = readPath(request, rule.path)
    const value = raw == null ? "" : String(raw)
    if (!value) {
      if (rule.required) {
        problems.push(`${rule.path} is mandatory and was empty`)
      }
      continue
    }
    if (value.length > rule.max) {
      problems.push(
        `${rule.path} is ${value.length} chars, max ${rule.max} ("${value}")`
      )
    } else if (rule.pattern && !rule.pattern.test(value)) {
      problems.push(
        `${rule.path} does not match ${rule.pattern} ("${value}")`
      )
    }
  }
  return problems
}

/**
 * Characters Blue Dart accepts in a name or address line, per the developer
 * guide: alphanumerics plus `./?;:'~!\@"#$%^&*()[]+=_-`, and space.
 *
 * The comma is deliberately EXCLUDED. The guide publishes the set as a
 * comma-separated list, which leaves the comma itself ambiguous — and an
 * ambiguous character is not worth a silent 400 on a billable waybill when
 * dropping it costs an address nothing a courier needs.
 */
const ALLOWED = /[^a-zA-Z0-9 ./?;:'~!\\@"#$%^&*()[\]+=_-]/g

/**
 * Strip characters Blue Dart rejects and collapse the whitespace that leaves
 * behind. Does NOT truncate — packing decides that, so a long line can be
 * wrapped onto the next field rather than losing its tail.
 */
export function sanitiseBlueDartText(value: unknown): string {
  return String(value ?? "")
    .replace(ALLOWED, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** A name or single field: sanitised and hard-truncated to the cap. */
export function blueDartField(
  value: unknown,
  max: number = BLUEDART_TEXT_MAX
): string {
  return sanitiseBlueDartText(value).slice(0, max)
}

/**
 * `CreditReferenceNo` — our reference, echoed back by Blue Dart. **Mandatory,
 * max 20, A-Z and 0-9 ONLY.**
 *
 * A Medusa order id (`order_01KYPCSTQ783ZT1FKM72VHQABS`) breaks all three
 * rules at once: 32 characters, lowercase, and an underscore. It is passed
 * verbatim as `reference_id` by every caller, so this field alone rejected
 * every waybill the app has ever attempted — silently, with an empty 400.
 *
 * Keeps the LAST 20 characters, not the first. The leading `ORDER` is constant
 * across every order and would burn a quarter of the budget on nothing, while
 * the ULID tail is where the entropy lives — truncating from the front would
 * make references collide.
 */
export function blueDartReference(value: unknown, max = 20): string {
  const alnum = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  return alnum.slice(-max)
}

/** Alphanumeric + space only, capped — what Commodity accepts. */
export function blueDartAlnum(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

/** Digits only — what Pincode and Mobile accept. */
export function blueDartDigits(value: unknown, max?: number): string {
  const digits = String(value ?? "").replace(/\D/g, "")
  return max ? digits.slice(0, max) : digits
}

/**
 * Pack address parts into Blue Dart's three 30-character lines.
 *
 * Wraps on WORD boundaries so a line breaks between words rather than mid-street
 * — "Ram Nagar Road Sharlho Factory" / "Ward 11" instead of a hard cut. A single
 * word longer than the cap (rare, but a run-on building code does it) is split
 * hard, because refusing to split would drop it entirely.
 *
 * Overflow past the third line is discarded rather than crammed: Blue Dart
 * prints these lines on the label, and the parts that fit are the ones a courier
 * needs. The pincode, which is what actually routes the parcel, is a separate
 * mandatory field and is never at risk from this.
 */
export function packBlueDartAddress(
  ...parts: Array<string | null | undefined>
): { line1: string; line2: string; line3: string } {
  const words = parts
    .map((p) => sanitiseBlueDartText(p))
    .filter(Boolean)
    .join(" ")
    .split(" ")
    .filter(Boolean)

  const lines: string[] = []
  let current = ""
  const flush = () => {
    if (current) {
      lines.push(current)
      current = ""
    }
  }

  for (let word of words) {
    // A single over-long word can never fit a line; break it up rather than
    // silently dropping it.
    while (word.length > BLUEDART_TEXT_MAX) {
      flush()
      if (lines.length >= 3) break
      lines.push(word.slice(0, BLUEDART_TEXT_MAX))
      word = word.slice(BLUEDART_TEXT_MAX)
    }
    if (lines.length >= 3) break
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= BLUEDART_TEXT_MAX) {
      current = candidate
    } else {
      flush()
      if (lines.length >= 3) break
      current = word
    }
  }
  flush()

  return {
    line1: lines[0] || "",
    line2: lines[1] || "",
    line3: lines[2] || "",
  }
}
