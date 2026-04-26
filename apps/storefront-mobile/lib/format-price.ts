/**
 * Format a price amount with currency code
 * Note: Medusa v2 stores prices in major units (dollars, not cents)
 */
export function formatPrice(
  amount: number | undefined,
  currencyCode: string | undefined
): string {
  if (amount === undefined || amount === null || !currencyCode) {
    return "N/A"
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(amount)
}
