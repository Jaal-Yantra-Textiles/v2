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
