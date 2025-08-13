import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";
  import { MedusaError } from "@medusajs/framework/utils";
  import { uploadAndOrganizeMediaWorkflow } from "../../../workflows/media/upload-and-organize-media";
  import { listAllMediasWorkflow } from "../../../workflows/media/list-all-medias";
import { UploadMediaRequest } from "./validator";

  
  export const POST = async (
    req: MedusaRequest<UploadMediaRequest> & { 
      files?: Express.Multer.File[] 
    },
    res: MedusaResponse
  ) => {
    try {
      // Normalize uploaded files (support single or multiple)
      const uploadedFiles: Express.Multer.File[] = Array.isArray(req.files)
        ? (req.files as Express.Multer.File[])
        : (req.file ? [req.file as Express.Multer.File] : [])
      console.log("Uploaded files:", uploadedFiles);
      console.log("Body:", req.validatedBody);
      if (!uploadedFiles || uploadedFiles.length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "No files were uploaded"
        );
      }

      // Transform multer files to workflow input format
      const files = uploadedFiles.map((file) => ({
        filename: file.originalname,
        mimeType: file.mimetype,
        content: file.buffer,
      }));

      // Normalize/clean validated body for workflow typing
      const body = { ...(req.validatedBody ?? {}) } as any
      if (body.folder && (body.folder.parent_folder_id === null || body.folder.parent_folder_id === undefined || body.folder.parent_folder_id === "")) {
        delete body.folder.parent_folder_id
      }

      // Run the upload and organize workflow
      const { result, errors } = await uploadAndOrganizeMediaWorkflow(req.scope).run({
        input: {
          files,
          ...body,
        },
      });

      if (errors.length > 0) {
        console.error("Errors occurred during media upload:", errors);
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Failed to upload media: ${errors.map(e => e.error?.message || "Unknown error").join(", ")}`
        );
      }

      return res.status(201).json({
        message: "Media uploaded and organized successfully",
        result,
      });
    } catch (error) {
      console.error("Error uploading media:", error);
      if (error instanceof MedusaError) {
        const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
        return res.status(status).json({ message: (error as Error).message })
      }
      return res.status(500).json({ message: "An unexpected error occurred" })
    }
  };

  // Lists all media entities: folders, albums, media files, and album-media links
  export const GET = async (
    req: MedusaRequest,
    res: MedusaResponse
  ) => {
    try {
      // Optionally forward query filters/config if provided
      const { filters, config, ...restQuery } = (req.query || {}) as Record<string, any>;

      // Allow simple pagination via query (?skip=0&take=50)
      const baseConfig = {
        skip: restQuery.skip ? Number(restQuery.skip) : undefined,
        take: restQuery.take ? Number(restQuery.take) : undefined,
      } as { skip?: number; take?: number };

      const { result } = await listAllMediasWorkflow(req.scope).run({
        input: {
          filters: (filters as Record<string, any>) || {},
          config: { ...(config as Record<string, any>), ...baseConfig },
        },
      });

      res.status(200).json(result);
    } catch (error) {
      console.error("Error listing medias:", error);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to list media entities"
      );
    }
  };

