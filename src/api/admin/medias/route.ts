import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";
  import { MedusaError } from "@medusajs/framework/utils";
  import { uploadAndOrganizeMediaWorkflow } from "../../../workflows/media/upload-and-organize-media";
  import { listAllMediasWorkflow } from "../../../workflows/media/list-all-medias";
import { UploadMediaRequest } from "./validator";
import fs from "fs";

  
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
      // Support both memoryStorage (buffer) and diskStorage (path -> stream)
      const files = uploadedFiles.map((file) => {
        const hasBuffer = (file as any).buffer && Buffer.isBuffer((file as any).buffer)
        const hasPath = (file as any).path && typeof (file as any).path === "string"
        const buffer = hasBuffer
          ? (file as any).buffer
          : hasPath
            ? fs.readFileSync((file as any).path)
            : Buffer.from([])
        return {
          filename: file.originalname,
          mimeType: file.mimetype,
          content: buffer,
          // keep a tempPath for cleanup if present
          _tempPath: hasPath ? (file as any).path : undefined,
        } as any
      })

      // Normalize/clean validated body for workflow typing
      const body = { ...(req.validatedBody ?? {}) } as any
      if (body.folder && (body.folder.parent_folder_id === null || body.folder.parent_folder_id === undefined || body.folder.parent_folder_id === "")) {
        delete body.folder.parent_folder_id
      }

      // Run the upload and organize workflow
      const { result, errors } = await uploadAndOrganizeMediaWorkflow(req.scope).run({
        input: {
          files: files as any,
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

      // Cleanup temp files if any
      try {
        for (const f of files as any[]) {
          if (f._tempPath) {
            fs.unlink(f._tempPath, () => {})
          }
        }
      } catch {}

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
      return res.status(500).json({ message: (error as any)?.message || "An unexpected error occurred" })
    }
  };

  // Lists all media entities: folders, albums, media files, and album-media links
  export const GET = async (
    req: MedusaRequest,
    res: MedusaResponse
  ) => {
    try {
      // Optionally forward query filters/config if provided, but normalize types first
      const { filters: rawFilters, config: rawConfig, ...restQuery } = (req.query || {}) as Record<string, any>

      // Allow simple pagination via query (?skip=0&take=50)
      const baseConfig: { skip?: number; take?: number } = {
        skip: restQuery.skip !== undefined ? Number(restQuery.skip) : undefined,
        take: restQuery.take !== undefined ? Number(restQuery.take) : undefined,
      }

      // Normalize config if provided as JSON string
      let config: Record<string, any> | undefined
      if (typeof rawConfig === "string") {
        try {
          config = JSON.parse(rawConfig)
        } catch {
          config = undefined
        }
      } else if (rawConfig && typeof rawConfig === "object") {
        config = { ...rawConfig }
      }

      // Normalize filters: handle bracket-notation objects or JSON string, and coerce types
      let filters: Record<string, any> = {}
      if (typeof rawFilters === "string") {
        try {
          filters = JSON.parse(rawFilters)
        } catch {
          // If it's an unexpected string, ignore and use empty filters
          filters = {}
        }
      } else if (rawFilters && typeof rawFilters === "object") {
        filters = { ...rawFilters }
      }

      // Coerce known filter types
      if (filters.is_public !== undefined) {
        if (typeof filters.is_public === "string") {
          filters.is_public = filters.is_public === "true" ? true : filters.is_public === "false" ? false : filters.is_public
        }
      }
      // Remove empty string values that should be treated as undefined
      if (filters.parent_folder_id === "" || filters.parent_folder_id === null) {
        delete filters.parent_folder_id
      }
      if (filters.q === "") {
        delete filters.q
      }

      const { result } = await listAllMediasWorkflow(req.scope).run({
        input: {
          filters,
          config: { ...(config || {}), ...baseConfig },
        },
      })

      res.status(200).json(result);
    } catch (error) {
      console.error("Error listing medias:", error);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to list media entities"
      );
    }
  };

