export interface ExtractedOrderItem {
  name: string
  quantity: number | null
  price: number | null
  sku: string | null
}

export interface ExtractedOrderData {
  vendor: string | null
  order_number: string | null
  order_date: string | null
  items: ExtractedOrderItem[]
  subtotal: number | null
  shipping_cost: number | null
  tax: number | null
  total: number | null
  tracking_number: string | null
  tracking_url: string | null
  estimated_delivery: string | null
  currency: string | null
}

export function parseOrderEmail(html: string, fromAddress: string): ExtractedOrderData {
  const text = stripHtml(html)

  return {
    vendor: extractVendor(fromAddress),
    order_number: extractOrderNumber(text),
    order_date: extractDate(text, /order\s*date[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i),
    items: extractItems(html, text),
    subtotal: extractPrice(text, /sub\s*total[:\s]*\$?([\d,]+\.?\d*)/i),
    shipping_cost: extractPrice(text, /shipping[:\s]*\$?([\d,]+\.?\d*)/i),
    tax: extractPrice(text, /tax[:\s]*\$?([\d,]+\.?\d*)/i),
    total: extractPrice(text, /(?:order\s*)?total[:\s]*\$?([\d,]+\.?\d*)/i),
    tracking_number: extractTracking(text),
    tracking_url: extractTrackingUrl(html),
    estimated_delivery: extractDate(text, /(?:estimated|expected)\s*delivery[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i),
    currency: extractCurrency(text),
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractVendor(fromAddress: string): string | null {
  const domain = fromAddress.split("@")[1]
  if (!domain) return null
  return domain.split(".")[0] || null
}

function extractOrderNumber(text: string): string | null {
  const patterns = [
    /order\s*(?:#|number|no\.?)[:\s]*([A-Z0-9-]+)/i,
    /(?:#|order\s*id)[:\s]*([A-Z0-9-]+)/i,
    /confirmation\s*(?:#|number)[:\s]*([A-Z0-9-]+)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return null
}

function extractDate(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern)
  return match ? match[1].trim() : null
}

function extractPrice(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern)
  if (!match) return null
  const cleaned = match[1].replace(/,/g, "")
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function extractItems(html: string, text: string): ExtractedOrderItem[] {
  const items: ExtractedOrderItem[] = []

  // Try table-based extraction first
  const tableRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
  for (const row of tableRows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []
    if (cells.length >= 2) {
      const cellTexts = cells.map((c) =>
        c.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      )

      // Heuristic: look for rows with a name and a price
      const nameCell = cellTexts.find((c) => c.length > 3 && !/^\$?\d/.test(c))
      const priceCell = cellTexts.find((c) => /\$?\d+\.?\d*/.test(c))

      if (nameCell && priceCell) {
        const priceMatch = priceCell.match(/\$?([\d,]+\.?\d*)/)
        const qtyMatch = cellTexts.join(" ").match(/(?:qty|quantity)[:\s]*(\d+)/i)
          || cellTexts.find((c) => /^\d+$/.test(c))

        items.push({
          name: nameCell,
          quantity: qtyMatch
            ? parseInt(typeof qtyMatch === "string" ? qtyMatch : qtyMatch[1], 10)
            : 1,
          price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null,
          sku: extractItemSku(cellTexts.join(" ")),
        })
      }
    }
  }

  // Fallback: line-item pattern in text
  if (items.length === 0) {
    const linePattern = /(.{5,50})\s+x?\s*(\d+)\s+\$?([\d,]+\.?\d*)/g
    let match
    while ((match = linePattern.exec(text)) !== null) {
      items.push({
        name: match[1].trim(),
        quantity: parseInt(match[2], 10),
        price: parseFloat(match[3].replace(/,/g, "")),
        sku: null,
      })
    }
  }

  return items
}

function extractItemSku(text: string): string | null {
  const match = text.match(/(?:sku|item\s*#?)[:\s]*([A-Z0-9-]+)/i)
  return match ? match[1] : null
}

function extractTracking(text: string): string | null {
  const patterns = [
    /tracking\s*(?:#|number|no\.?)[:\s]*([A-Z0-9]+)/i,
    /(?:1Z[A-Z0-9]{16})/i, // UPS
    /(?:\d{20,22})/,        // FedEx/USPS
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1] || match[0]
  }
  return null
}

function extractTrackingUrl(html: string): string | null {
  const match = html.match(/href=["']([^"']*(?:track|shipment)[^"']*)["']/i)
  return match ? match[1] : null
}

function extractCurrency(text: string): string | null {
  if (/\$/.test(text)) return "USD"
  if (/€/.test(text)) return "EUR"
  if (/£/.test(text)) return "GBP"
  if (/₹/.test(text)) return "INR"
  return null
}
