/**
 * Generates a CSV template for person import
 * 
 * @returns A data URL containing a CSV template
 */
export const getPersonImportCsvTemplate = (): string => {
  // Define all supported fields
  const header = [
    // Required fields
    "id", // Leave empty for new persons, include ID for updates
    "first_name",
    "last_name", 
    "email",
    
    // Contact details
    "phone", // Primary phone
    "mobile", // Mobile phone
    "fax", // Fax number
    
    // Additional person fields
    "date_of_birth", // Format: YYYY-MM-DD
    "avatar", // URL to avatar image
    "state", // One of: Onboarding, Stalled, Conflicted, Onboarding Finished
    
    // Associations (comma-separated lists)
    "tags", // Comma-separated list of tag names
    "person_types", // Comma-separated list of person type names
    
    // Address fields
    "Address Line 1", // Primary address line
    "Address Line 2", // Secondary address line
    "City", // City
    "Postal Code", // Postal/ZIP code
    "Province", // State/Province
    "Country", // Country code (e.g., USA)
    
    // Custom metadata fields
    "Metadata Field 1", // Example custom field
    "Metadata Field 2" // Example custom field
  ].join(",")
  
  // Add example data rows
  const rows = [
    // Example 1: New person with all fields
    [
      "", // id (empty for new person)
      "John", // first_name
      "Doe", // last_name
      "john.doe@example.com", // email
      "+1234567890", // phone
      "+1234567891", // mobile
      "+1234567892", // fax
      "1990-01-01", // date_of_birth
      "https://example.com/avatar.jpg", // avatar
      "Onboarding", // state
      "VIP,Important", // tags
      "Customer,Vendor", // person_types
      "123 Main St", // Address Line 1
      "Apt 4B", // Address Line 2
      "New York", // City
      "10001", // Postal Code
      "NY", // Province
      "USA", // Country
      "Custom Value 1", // Metadata Field 1
      "Custom Value 2" // Metadata Field 2
    ].join(","),
    
    // Example 2: New person with minimal fields
    [
      "", // id
      "Jane", // first_name
      "Smith", // last_name
      "jane.smith@example.com", // email
      "+0987654321", // phone
      "+0987654322", // mobile
      "", // fax
      "1985-05-15", // date_of_birth
      "", // avatar
      "", // state
      "Partner", // tags
      "Vendor,VIP", // person_types
      "", // Address Line 1
      "", // Address Line 2
      "", // City
      "", // Postal Code
      "", // Province
      "", // Country
      "", // Metadata Field 1
      "" // Metadata Field 2
    ].join(","),
    
    // Example 3: Update existing person (include ID)
    [
      "{PERSON_ID}", // id (replace with actual ID when updating)
      "Updated", // first_name
      "Person", // last_name
      "updated.person@example.com", // email
      "+1122334455", // phone
      "+1122334456", // mobile
      "+1122334457", // fax
      "1975-03-20", // date_of_birth
      "https://example.com/updated.jpg", // avatar
      "Active", // state
      "Important,VIP", // tags
      "Customer,VIP", // person_types
      "500 Update Rd", // Address Line 1
      "Floor 3", // Address Line 2
      "Boston", // City
      "02108", // Postal Code
      "MA", // Province
      "USA", // Country
      "Updated Value 1", // Metadata Field 1
      "Updated Value 2" // Metadata Field 2
    ].join(",")
  ]
  
  // Combine all rows
  const csv = [header, ...rows].join("\n")
  
  // Create a data URL for downloading
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
}
