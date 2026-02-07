/**
 * @file Admin API route for importing persons from CSV files
 * @description Provides functionality to upload and process CSV files containing person data
 * @module API/Admin/Persons
 */

/**
 * @typedef {Object} PersonImportRequest
 * @property {File} file - The CSV file containing person data to be imported
 * @property {string} file.originalname - Original filename of the uploaded file
 * @property {Buffer} file.buffer - File content buffer
 */

/**
 * @typedef {Object} PersonImportResponse
 * @property {string} transaction_id - Unique identifier for the import transaction
 * @property {Object} summary - Summary of the import operation results
 * @property {number} summary.total - Total number of records processed
 * @property {number} summary.success - Number of successfully imported records
 * @property {number} summary.failed - Number of failed records
 * @property {Array<string>} [summary.errors] - Array of error messages for failed records
 */

/**
 * Import persons from a CSV file
 * @route POST /admin/persons/import
 * @group Person - Operations related to person management
 * @param {PersonImportRequest} request.body.required - CSV file containing person data
 * @returns {PersonImportResponse} 202 - Import transaction details and summary
 * @throws {MedusaError} 400 - No file was uploaded or invalid file format
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 500 - Internal server error during processing
 *
 * @example request
 * POST /admin/persons/import
 * Content-Type: multipart/form-data
 * --boundary
 * Content-Disposition: form-data; name="file"; filename="persons.csv"
 * Content-Type: text/csv
 *
 * name,email,phone
 * John Doe,john@example.com,555-1234
 * Jane Smith,jane@example.com,555-5678
 * --boundary--
 *
 * @example response 202
 * {
 *   "transaction_id": "import_789012345",
 *   "summary": {
 *     "total": 2,
 *     "success": 2,
 *     "failed": 0,
 *     "errors": []
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "No file was uploaded for importing persons",
 *   "code": "invalid_data",
 *   "type": "invalid_data"
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { importPersonsWorkflow } from "../../../../workflows/persons/import-person/workflows/import-persons"

export interface PersonImportRequest {
  file: File
}
/**
 * @swagger
 * /admin/persons/import:
 *   post:
 *     summary: Import persons from a CSV file
 *     description: Uploads and imports persons data from a CSV file.
 *     tags:
 *       - Person
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       202:
 *         description: Accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction_id:
 *                   type: string
 *                 summary:
 *                   type: object
 */
export const POST = async (
  req: MedusaRequest<PersonImportRequest>,
  res: MedusaResponse
) => {
  const file = req.file as Express.Multer.File
  // Check if we successfully extracted the file content
  if (!file) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No file was uploaded for importing persons"
    );
  }
  
  
  // Process the file content
  const { result, transaction } = await importPersonsWorkflow(req.scope).run({
    input: {
      filename: file.originalname,
      fileContent: file.buffer.toString("utf-8"),
    },
  })

  res
    .status(202)
    .json({ transaction_id: transaction.transactionId, summary: result })
}
