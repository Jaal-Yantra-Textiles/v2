import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { convertCsvToJson } from "../utils/csv-utils"
import { normalizePersonDataForImport } from "../utils/normalize-person-import"
import PersonService from "../../../../modules/person/service"
import { PERSON_MODULE } from "../../../../modules/person"

/**
 * The CSV file content to parse.
 */
export type ParsePersonCsvStepInput = string

export const parsePersonCsvStepId = "parse-person-csv"
/**
 * This step parses a CSV file holding persons to import, returning the persons as
 * objects that can be imported.
 *
 * @example
 * const data = parsePersonCsvStep("persons.csv")
 */
export const parsePersonCsvStep = createStep(
  parsePersonCsvStepId,
  async (fileContent: ParsePersonCsvStepInput, { container }) => {
    // 1. Convert CSV to JSON
    const csvPersons = convertCsvToJson(fileContent)

    // Normalize field names and validate required fields
    const requiredFields = ["email", "first_name", "last_name"]
    
    csvPersons.forEach((person: any, index: number) => {
      // Normalize keys to lowercase for case-insensitive validation
      const normalizedPerson: Record<string, any> = {}
      Object.keys(person).forEach(key => {
        const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, "_")
        normalizedPerson[normalizedKey] = person[key]
      })
      
      // Check for required fields using normalized keys
      for (const field of requiredFields) {
        // Check various possible formats of the field name
        const possibleKeys = [
          field,                           // email
          field.replace("_", ""),         // firstname
          field.toLowerCase(),             // email
          field.toUpperCase(),             // EMAIL
          field.charAt(0).toUpperCase() + field.slice(1) // Email
        ]
        
        const hasField = possibleKeys.some(key => 
          person[key] !== undefined && person[key] !== null && person[key] !== "")
        
        if (!hasField) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${field.charAt(0).toUpperCase() + field.slice(1).replace("_", " ")} is required when importing persons (row ${index + 1})`
          )
        }
      }
    })

    // 2. Load all person types and tags to match against CSV data
    // These services would need to be implemented based on your application structure
    const personTypeService:PersonService = container.resolve(PERSON_MODULE)
  

    const [personTypes, tags] = await Promise.all([
      personTypeService.listPeople({}, {}),
      personTypeService.listTags({}, {}),
    ])

    // 3. Normalize the data for import using our helper function
    const normalizedData = normalizePersonDataForImport(csvPersons, {
      personTypes,
      tags,
    })

    return new StepResponse(normalizedData)
  }
)
