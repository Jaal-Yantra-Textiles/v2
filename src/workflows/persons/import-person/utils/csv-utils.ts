import { parse } from "csv-parse/sync"

/**
 * Convert a CSV string to a JSON array.
 * @param csvContent - The CSV content as a string
 * @returns An array of objects representing the CSV rows
 */
export function convertCsvToJson(csvContent: string): Record<string, unknown>[] {
  try {
    return parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })
  } catch (error) {
    throw new Error(`Error parsing CSV: ${error.message}`)
  }
}
