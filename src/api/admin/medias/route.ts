
/**
 * POST /admin/medias
 *
 * Upload one or more media files and organize them (folders/albums) by invoking the
 * uploadAndOrganizeMediaWorkflow.
 *
 * Behavior:
 * - Accepts single or multiple files via multer (req.file or req.files).
 * - Each file is read into a binary string and passed to the workflow as:
 *   { filename, mimeType, content, _tempPath? }.
 * - Optionally accepts a validated body (req.validatedBody) containing organization
 *   instructions (e.g. folder info, album links, is_public, etc.). If a folder
 *   contains parent_folder_id as null/empty string, parent_folder_id will be removed.
 * - Attempts to run the workflow and returns 201 with the workflow result on success.
 * - Cleans up any temporary uploaded files when present.
 *
 * Request:
 * - Content-Type: multipart/form-data
 * - Files: one or more files (field name used by multer configuration; file objects used from req.file/req.files)
 * - Optional body fields (example):
 *   {
 *     folder: { name?: string, parent_folder_id?: string },
 *     is_public?: boolean,
 *     q?: string,
 *     ...other workflow inputs
 *   }
 *
 * Responses:
 * - 201: { message: string, result: any } - success
 * - 400: { message: string } - invalid data (e.g. no files)
 * - 500: { message: string } - unexpected errors or workflow failures
 *
 * Examples:
 *
 * Curl (single file):
 * curl -X POST "https://example.com/admin/medias" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -F "files=@/path/to/image.jpg" \
 *   -F 'folder={"name":"My Uploads","parent_folder_id":"1234"}'
 *
 * Curl (multiple files):
 * curl -X POST "https://example.com/admin/medias" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -F "files[]=@/path/to/image1.jpg" \
 *   -F "files[]=@/path/to/image2.png"
 *
 * Node fetch example (browser/Node with form-data):
 * const fd = new FormData();
 * fd.append("files", fileInput.files[0]); // browser File
 * fd.append("folder", JSON.stringify({ name: "MyFolder" }));
 * fetch("/admin/medias", { method: "POST", body: fd, headers: { Authorization: "Bearer <token>" } });
 *
 * @param req - MedusaRequest<UploadMediaRequest> & { files?: Express.Multer.File[] }
 * @param res - MedusaResponse
 * @throws MedusaError on validation or workflow failure
 */

/**
 * GET /admin/medias
 *
 * List all media-related entities (folders, albums, media files, album-media links) using
 * listAllMediasWorkflow. Supports flexible query formats for filters and configuration.
 *
 * Query parameters:
 * - filters: JSON string or object (or bracket-notation) describing filter conditions.
 *   Common keys:
 *     - is_public: boolean | "true" | "false"
 *     - parent_folder_id: string | omitted to list root items
 *     - q: string (search text)
 *   Examples:
 *     - ?filters={"is_public":true,"q":"logo"}
 *     - ?filters[is_public]=true&filters[q]=logo
 *
 * - config: JSON string or object with configuration options passed to the workflow (e.g. ordering).
 *   Examples:
 *     - ?config={"order":"created_at:desc"}
 *     - ?config[order]=created_at:desc
 *
 * - skip: number (pagination offset)
 * - take: number (pagination limit)
 *
 * Behavior:
 * - Parses raw query values: JSON string parsing for filters/config, coercion for boolean-like strings.
 * - Removes empty parent_folder_id and empty q values so they are treated as unspecified.
 * - Merges skip/take into the final config passed to the workflow.
 * - Returns workflow result (typically a paginated list and metadata).
 *
 * Responses:
 * - 200: workflow result (list of media entities)
 * - 500: throws MedusaError with "Failed to list media entities" on unexpected errors
 *
 * Examples:
 *
 * Curl (basic list, pagination):
 * curl -X GET "https://example.com/admin/medias?skip=0&take=50" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * Curl (filters and config as JSON strings):
 * curl -G "https://example.com/admin/medias" \
 *   --data-urlencode 'filters={"is_public":true,"q":"banner"}' \
 *   --data-urlencode 'config={"order":"created_at:desc"}' \
 *   --data-urlencode 'skip=0' \
 *   --data-urlencode 'take=25' \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * Curl (bracket-notation filters):
 * curl -G "https://example.com/admin/medias" \
 *   --data-urlencode 'filters[is_public]=true' \
 *   --data-urlencode 'filters[q]=logo' \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * @param req - MedusaRequest
 * @param res - MedusaResponse
 * @throws MedusaError on unexpected failure
 */
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
      
      if (!uploadedFiles || uploadedFiles.length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "No files were uploaded"
        );
      }

      // Transform multer files to workflow input format
      // Pass content as a binary string to avoid Buffer in workflow inputs
      const files = uploadedFiles.map((file) => {
        const hasBuffer = (file as any).buffer && Buffer.isBuffer((file as any).buffer)
        const hasPath = (file as any).path && typeof (file as any).path === "string"
        const contentStr = hasBuffer
          ? (file as any).buffer.toString("binary")
          : hasPath
            ? fs.readFileSync((file as any).path).toString("binary")
            : ""
        return {
          filename: file.originalname,
          mimeType: file.mimetype,
          content: contentStr,
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

      // Validate file_type filter against allowed enum values
      if (filters.file_type !== undefined) {
        const validTypes = ["image", "video", "audio", "document", "archive", "other"]
        if (typeof filters.file_type !== "string" || !validTypes.includes(filters.file_type)) {
          delete filters.file_type
        }
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

