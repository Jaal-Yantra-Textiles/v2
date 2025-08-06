import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { uploadAndOrganizeMediaWorkflow } from "../../../workflows/media/upload-and-organize-media";
import { UploadMediaRequest } from "./validators";

export const POST = async (
  req: MedusaRequest<UploadMediaRequest> & { 
    files?: Express.Multer.File[] 
  },
  res: MedusaResponse
) => {
  // Check if files were uploaded
  if (!req.files || req.files.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No files were uploaded"
    );
  }

  // Transform multer files to workflow input format
  const files = req.files.map((file) => ({
    filename: file.originalname,
    mimeType: file.mimetype,
    content: file.buffer,
  }));

  console.log("Files:", files);
  console.log("Body:", req.validatedBody);
  
  try {
    // Run the upload and organize workflow
    const { result, errors } = await uploadAndOrganizeMediaWorkflow(req.scope).run({
      input: {
        files,
        ...req.validatedBody,
      },
    });

    if (errors.length > 0) {
      console.error("Errors occurred during media upload:", errors);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to upload media: ${errors.map(e => e.error?.message || "Unknown error").join(", ")}`
      );
    }

    res.status(201).json({
      message: "Media uploaded and organized successfully",
      result,
    });
  } catch (error) {
    console.error("Error uploading media:", error);
    throw error;
  }
};
