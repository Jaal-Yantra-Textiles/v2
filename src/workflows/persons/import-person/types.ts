/**
 * The configurations to import persons.
 */
export interface ImportPersonsDTO {
  /**
   * The content of the CSV file.
   */
  fileContent: string
  /**
   * The name of the CSV file.
   */
  filename: string
}

export interface ImportPersonsSummary {
  toCreate: number
  toUpdate: number
}
