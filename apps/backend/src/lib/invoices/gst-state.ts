/**
 * Indian GST state codes (#2532).
 *
 * 🔑 A GSTIN's first two digits ARE its state. The seller's state on a tax
 * invoice is the state of the registration it is issued under — not wherever
 * the goods happen to sit. Our registration is 07 (Delhi) while stock ships
 * from Dharamshala (02), and confusing the two flips CGST+SGST and IGST.
 */

/** GST state code → state name (code 25 merged into 26 in 2020). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
}

/** ISO 3166-2:IN subdivision codes and common spellings → GST code. */
const ALIASES: Record<string, string> = {
  jk: "01", hp: "02", pb: "03", ch: "04", uk: "05", ut: "05", uttaranchal: "05",
  hr: "06", dl: "07", newdelhi: "07", nctofdelhi: "07", nationalcapitalterritoryofdelhi: "07",
  rj: "08", up: "09", br: "10", sk: "11", ar: "12", nl: "13", mn: "14", mz: "15",
  tr: "16", ml: "17", as: "18", wb: "19", jh: "20", od: "21", or: "21", orissa: "21",
  cg: "22", ct: "22", mp: "23", gj: "24", dh: "26", dn: "26", dd: "26", mh: "27",
  ka: "29", ga: "30", ld: "31", kl: "32", tn: "33", py: "34", pondicherry: "34",
  an: "35", tg: "36", ts: "36", ap: "37", la: "38",
}

const norm = (value: string): string => value.toLowerCase().replace(/[^a-z]/g, "")

const BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(GST_STATES).map(([code, name]) => [norm(name), code])
)

/** The GST state code of a GSTIN, or null when it does not start with one. */
export function gstinStateCode(gstin?: string | null): string | null {
  const code = String(gstin ?? "").trim().slice(0, 2)
  return GST_STATES[code] ? code : null
}

/**
 * The GST state code for a free-text state ("Himachal Pradesh", "HP",
 * "New Delhi", "MH"), or null when it cannot be read.
 */
export function stateCodeOf(state?: string | null): string | null {
  const key = norm(String(state ?? ""))
  if (!key) return null
  return BY_NAME[key] ?? ALIASES[key] ?? null
}

export function stateName(code: string | null): string | null {
  return code ? GST_STATES[code] ?? null : null
}
