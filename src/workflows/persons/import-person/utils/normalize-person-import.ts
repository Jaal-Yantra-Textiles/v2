/**
 * Normalizes the CSV person data for import.
 * @param csvPersons - The persons data from the CSV
 * @param options - Additional options for normalization
 * @returns Normalized person data ready for import
 */
export function normalizePersonDataForImport(
  csvPersons: Record<string, unknown>[],
  options: {
    personTypes?: any[]
    tags?: any[]
  }
): any[] {
  console.log(`Starting normalization of ${csvPersons.length} CSV records`);
  const { personTypes = [], tags = [] } = options
  // Create maps for looking up person types and tags, with proper null checks
  const personTypeMap = new Map(
    personTypes
      .filter((type) => type && type.name) // Filter out entries with no name
      .map((type) => [type.name.toLowerCase(), type.id])
  )
  
  const tagMap = new Map(
    tags
      .filter((tag) => tag && tag.value) // Filter out entries with no value
      .map((tag) => [tag.value.toLowerCase(), tag.id])
  )

  return csvPersons.map((person, index) => {
    console.log(`Normalizing person record ${index + 1}:`, JSON.stringify(person, null, 2));
    // Helper function to get field value from various possible key formats
    const getFieldValue = (baseName: string, defaultValue: any = "") => {
      // Generate possible key variations
      const possibleKeys = [
        baseName,                                  // first_name
        baseName.replace(/_/g, " "),              // first name
        baseName.replace(/_/g, ""),               // firstname
        baseName.toLowerCase(),                     // first_name
        baseName.toUpperCase(),                     // FIRST_NAME
        baseName.split('_').map(part => 
          part.charAt(0).toUpperCase() + part.slice(1)
        ).join(' '),                              // First Name
        baseName.split('_').map(part => 
          part.charAt(0).toUpperCase() + part.slice(1)
        ).join('')                                // FirstName
      ]
      
      // Find the first key that exists in the person object
      for (const key of possibleKeys) {
        if (person[key] !== undefined && person[key] !== null && person[key] !== "") {
          return person[key]
        }
      }
      
      return defaultValue
    }
    
    // Basic person properties
    const normalizedPerson: any = {
      first_name: getFieldValue("first_name"),
      last_name: getFieldValue("last_name"),
      email: getFieldValue("email") || null,
      date_of_birth: getFieldValue("date_of_birth", null),
      avatar: getFieldValue("avatar", null),
      // Ensure state is one of the valid values (based on the constraint error)
      state: validateState(getFieldValue("state", "Onboarding")),
    }
    
    // Helper function to validate state values
    function validateState(state: string): string {
      // List of valid states based on the person model definition
      const validStates = ["Onboarding", "Stalled", "Conflicted", "Onboarding Finished"];
      
      // Check if the provided state is valid
      if (state && validStates.includes(state)) {
        return state;
      }
      
      // Default to "Onboarding" if invalid or not provided
      return "Onboarding";
    }

    // Handle ID for updates
    const id = getFieldValue("id", null) || getFieldValue("ID", null)
    if (id) {
      normalizedPerson.id = id
    }

    // Process tags if provided
    const tags = getFieldValue("tags", null)
    if (tags) {
      // Safely split and process tag values with null checks
      const tagValues = (tags as string).split(",").map(t => t ? t.trim() : "")
      normalizedPerson.tags = tagValues
        .filter(tagValue => tagValue) // Filter out empty tags
        .map((tagValue) => {
          // Safe toLowerCase with null check
          const tagId = tagValue ? tagMap.get(tagValue.toLowerCase()) : undefined
          // Return existing tag ID or create a new tag object with the correct property name
          return tagId ? { id: tagId } : { name: tagValue }
        })
    }

    // Process person types if provided
    const personTypes = getFieldValue("person_types", null) || getFieldValue("person types", null)
    if (personTypes) {
      // Safely split and process person type values with null checks
      const typeValues = (personTypes as string).split(",").map(t => t ? t.trim() : "")
      normalizedPerson.person_types = typeValues
        .filter(typeValue => typeValue) // Filter out empty type values
        .map((typeValue) => {
          // Safe toLowerCase with null check
          const typeId = typeValue ? personTypeMap.get(typeValue.toLowerCase()) : undefined
          // Return existing type ID or create a new type object with the name
          // This allows the batch-persons step to handle both existing and new types
          console.log(`Processing person type: ${typeValue}, found ID: ${typeId || 'not found'}`);
          return typeId ? { id: typeId } : { name: typeValue }
        })
    }

    // Process addresses if provided
    if (
      person["Address Line 1"] ||
      person["Address Line 2"] ||
      person["City"] ||
      person["Postal Code"] ||
      person["Province"] ||
      person["Country"]
    ) {
      // Only include fields that the database model actually uses
      normalizedPerson.addresses = [
        {
          street: person["Address Line 1"] || "",
          city: person["City"] || "",
          postal_code: person["Postal Code"] || "",
          country: person["Country"] || "",
          state: person["Province"] || "", // Required field for PersonAddress
        },
      ]
    }

    // Process contact details if provided
    // Check for phone, mobile, and fax in various possible formats
    const phoneValue = getFieldValue("phone") || person["Phone"] || "";
    const mobileValue = getFieldValue("mobile") || person["Mobile"] || "";
    const faxValue = getFieldValue("fax") || person["Fax"] || "";
    
    if (phoneValue || mobileValue || faxValue) {
      normalizedPerson.contact_details = []
      
      if (phoneValue) {
        normalizedPerson.contact_details.push({
          phone_number: phoneValue,
          type: "mobile", // Using mobile as it's one of the allowed enum values
        })
      }
      
      if (mobileValue) {
        normalizedPerson.contact_details.push({
          phone_number: mobileValue,
          type: "mobile",
        })
      }
      
      if (faxValue) {
        normalizedPerson.contact_details.push({
          phone_number: faxValue,
          type: "work", // Using work as it's one of the allowed enum values
        })
      }
    }

    // Process any additional metadata
    const metadata: Record<string, any> = {}
    Object.entries(person).forEach(([key, value]) => {
      // Add any custom fields not explicitly mapped to metadata
      if (
        !key.match(
          /^(ID|First Name|Last Name|Email|Date of Birth|Avatar|State|Tags|Person Types|Address Line 1|Address Line 2|City|Postal Code|Province|Country|Phone|Mobile|Fax)$/
        ) &&
        value
      ) {
        metadata[key] = value
      }
    })

    if (Object.keys(metadata).length > 0) {
      normalizedPerson.metadata = metadata
    }

    console.log(`Normalized person ${index + 1}:`, JSON.stringify(normalizedPerson, null, 2));
    return normalizedPerson
  })
}
