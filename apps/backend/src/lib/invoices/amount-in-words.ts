/**
 * Rupees in words, Indian numbering — "Fifty Eight Thousand Eight Hundred Fifty".
 *
 * Every supplier invoice in this business carries an amount-in-words line, and
 * it is not decoration: it is the line a human checks the figures against, and
 * the one a bank reads when the numerals are smudged. GOF's own invoice prints
 * "Fifty eight thousand eight hundred fifty only".
 *
 * 🔑 INDIAN grouping, not international. After the hundreds the groups are
 * thousand (10³), lakh (10⁵) and crore (10⁷) — NOT thousand/million/billion.
 * ₹5,850,000 is "Fifty Eight Lakh Fifty Thousand", never "Five Million…". A
 * western grouping here would be wrong on every invoice above a lakh, which is
 * most of them.
 *
 * PURE, so the arithmetic can be tested without a PDF.
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
]

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
]

/**
 * PURE: 0–99 in words. Returns "" for 0 so callers can test truthiness rather
 * than comparing against a "Zero" they would then have to strip.
 */
const twoDigits = (n: number): string => {
  if (n <= 0) return ""
  if (n < 20) return ONES[n]
  const tens = TENS[Math.floor(n / 10)]
  const ones = ONES[n % 10]
  return ones ? `${tens} ${ones}` : tens
}

/** PURE: 0–999 in words, including the "Hundred" join. */
const threeDigits = (n: number): string => {
  if (n <= 0) return ""
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest) parts.push(twoDigits(rest))
  return parts.join(" ")
}

/**
 * PURE: a whole number of rupees in words, Indian grouping.
 *
 * Handles up to 99,99,99,999 (just under a hundred crore) — beyond that the
 * caller gets the digits back rather than a wrong word, because an invoice that
 * silently understates its own amount in words is worse than one that declines
 * to spell it.
 */
export const wholeNumberToWords = (value: number): string => {
  if (!Number.isFinite(value)) return ""
  const n = Math.floor(Math.abs(value))
  if (n === 0) return "Zero"
  if (n > 9_99_99_99_999) return String(n)

  const crore = Math.floor(n / 1_00_00_000)
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000)
  const thousand = Math.floor((n % 1_00_000) / 1_000)
  const rest = n % 1_000

  const parts: string[] = []
  if (crore) parts.push(`${threeDigits(crore)} Crore`)
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`)
  if (rest) parts.push(threeDigits(rest))

  return parts.join(" ")
}

/**
 * An invoice's amount-in-words line, paise included when there are any.
 *
 * 🔑 Paise are rounded to two places FIRST, then split. Reading them off the
 * unrounded float gives 4999.999999 → "Ninety Nine Paise" beside a printed
 * ₹5,000.00, and the two lines of the same document then disagree.
 *
 * ⚠️ A negative amount is spelled with "Minus" rather than silently made
 * positive: an invoice total that came out negative is a fact the reader needs,
 * not one to tidy away.
 */
export const amountInWords = (
  value: number,
  currencyCode = "inr"
): string => {
  if (!Number.isFinite(value)) return ""

  const isNegative = value < 0
  const rounded = Math.round(Math.abs(value) * 100) / 100
  const rupees = Math.floor(rounded)
  const paise = Math.round((rounded - rupees) * 100)

  const unit = String(currencyCode).toLowerCase() === "inr" ? "Rupees" : String(currencyCode).toUpperCase()

  const parts: string[] = []
  if (isNegative) parts.push("Minus")
  parts.push(unit)
  parts.push(wholeNumberToWords(rupees))
  if (paise > 0) {
    parts.push("and")
    parts.push(twoDigits(paise))
    parts.push("Paise")
  }
  parts.push("only")

  return parts.join(" ")
}
