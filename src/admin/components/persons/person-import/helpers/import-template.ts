/**
 * Generates a CSV template for person import
 * 
 * @returns A data URL containing a CSV template
 */
export const getPersonImportCsvTemplate = (): string => {
  // Required fields: first_name, last_name, email
  const header = [
    "first_name",
    "last_name", 
    "email",
    "phone_number",
    "person_types", // Comma-separated list of type names
    "tags", // Comma-separated list of tag values
    "address_line_1",
    "address_line_2",
    "city",
    "country",
    "postal_code",
    "province"
  ].join(",")
  
  // Add example data rows
  const rows = [
    ["John", "Doe", "john.doe@example.com", "+1234567890", "Customer", "VIP,New", "123 Main St", "", "New York", "US", "10001", "NY"].join(","),
    ["Jane", "Smith", "jane.smith@example.com", "+0987654321", "Supplier", "Regular", "456 Elm St", "Apt 2B", "Boston", "US", "02108", "MA"].join(",")
  ]
  
  // Combine all rows
  const csv = [header, ...rows].join("\n")
  
  // Create a data URL for downloading
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
}
