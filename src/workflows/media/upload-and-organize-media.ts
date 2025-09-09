import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows";
import { MEDIA_MODULE } from "../../modules/media";
import MediaFileService from "../../modules/media/service";

// Define first to avoid TDZ when referenced by workflows declared later
export const validateExistingFolderStep = createStep(
  "validate-existing-folder-step",
  async (folderId: string, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    try {
      const folder = await service.retrieveFolder(folderId);
      return new StepResponse(folder, folderId);
    } catch (error) {
      throw new Error(`Folder with ID ${folderId} not found`);
    }
  },
  async (folderId: string) => {
    // No rollback needed for validation
  }
);

 

 


// Step 1: Create folder if needed
export type CreateFolderStepInput = {
  name: string;
  description?: string;
  parent_folder_id?: string;
  is_public?: boolean;
};

export const createFolderStep = createStep(
  "create-folder-step",
  async (input: CreateFolderStepInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    const slug = input.name.toLowerCase().replace(/\s+/g, "-");
    
    // If parent folder is specified, calculate path and level
    let folderData: any = {
      ...input,
      slug,
      sort_order: 0,
      is_public: input.is_public ?? true, // Default to public if not specified
    };
    
    if (input.parent_folder_id) {
      const parentFolder = await service.retrieveFolder(input.parent_folder_id);
      folderData.path = `${parentFolder.path}/${slug}`;
      folderData.level = parentFolder.level + 1;
    } else {
      // Root folder
      folderData.path = `/${slug}`;
      folderData.level = 0;
    }
    
    const folder = await service.createFolders(folderData);
    return new StepResponse(folder, folder.id);
  },
  async (folderId: string, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    await service.softDeleteFolders(folderId);
  }
);

// Step 2: Create album if needed (must be declared before workflows that use it)
export type CreateAlbumStepInput = {
  name: string;
  description?: string;
  type?: "gallery" | "portfolio" | "product" | "profile" | "general";
  is_public?: boolean;
  cover_media_id?: string;
};

export const createAlbumStep = createStep(
  "create-album-step",
  async (input: CreateAlbumStepInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    
    const slug = input.name.toLowerCase().replace(/\s+/g, "-");
    const album = await service.createAlbums({
      ...input,
      slug,
      sort_order: 0,
    });
    
    return new StepResponse(album, album.id);
  },
  async (albumId: string, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    await service.softDeleteAlbums(albumId);
  }
);

 

// Step 3: Upload files using Medusa's core workflow
export type UploadFilesStepInput = {
  files: {
    filename: string;
    mimeType: string;
    // keep both for backward compatibility; we'll map to `file` internally
    content?: Buffer | NodeJS.ReadableStream;
    file?: Buffer | NodeJS.ReadableStream;
  }[];
};

export const uploadFilesStep = createStep(
  "upload-files-step",
  async (input: UploadFilesStepInput, { container }) => {
    
    let result: any
    try {
      // Core flow expects `{ content }` as the binary property
      const filesForUpload = input.files.map((f) => ({
        filename: f.filename,
        mimeType: (f as any).mimeType,
        content: (f as any).content ?? (f as any).file,
      }))
      const out = await uploadFilesWorkflow.run({
        input: {
          files: filesForUpload,
        },
      })
      result = out.result
    } catch (e: any) {
      console.error("uploadFilesWorkflow failed:", e)
      throw new Error(`File upload failed: ${e?.message || e}`)
    }
    
    // Log basic info only
    const resultArray = Array.isArray(result)
      ? result
      : (result && typeof result === "object" && (result as any).files && Array.isArray((result as any).files))
        ? (result as any).files
        : (result && typeof result === "object" && (result as any).uploaded && Array.isArray((result as any).uploaded))
          ? (result as any).uploaded
          : []
    
    
    // Transform the result to match expected format for createMediaRecordsStep
    // We'll preserve the original file information that we have
    const transformedFiles = resultArray.map((file: any, index: number) => {
      // Avoid logging entire file objects
      
      // Get original file info from input
      const originalFile = input.files[index];
      
      // Try to extract file information from various possible field names
      const id = file.id || file.key || "unknown-id";
      const url = file.url || `http://localhost:9000/static/${id}`;
      // Use original filename if available, fallback to ID-based name
      const filename = originalFile?.filename || file.originalName || file.name || file.filename || id || "unknown";
      // Use original mimeType if available, fallback to extracted value
      const mimeType = originalFile?.mimeType || file.mimeType || file.type || file.contentType || "application/octet-stream";
      // Size may not be available when streaming
      const size = (originalFile as any)?.content?.length || (file as any).size || (file as any).fileSize || 0;
      
      return {
        id,
        url,
        filename,
        mimeType,
        size,
      };
    });
    
    
    return new StepResponse(transformedFiles, resultArray);
  },
  async (uploadResult, { container }) => {
    // Note: File deletion would need custom implementation
    // This is a placeholder for rollback logic
  }
);

// Step 4: Create MediaFile records and associate with albums/folders
export type CreateMediaRecordsStepInput = {
  uploadedFiles: Array<{
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
  folderId?: string;
  albumIds?: string[];
  metadata?: Record<string, any>;
};

export const createMediaRecordsStep = createStep(
  "create-media-records-step",
  async (input: CreateMediaRecordsStepInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    const mediaFiles = await Promise.all(
      input.uploadedFiles.map(async (file) => {
        const filename = file.filename || "unknown";
        const extension = filename.split(".").pop() || "";
        const fileType = getFileTypeFromMimeType(file.mimeType);
        
        const mediaFile = await service.createMediaFiles({
          file_name: filename,
          original_name: filename,
          file_path: file.url,
          file_size: file.size,
          file_type: fileType as "image" | "video" | "audio" | "document" | "archive" | "other",
          mime_type: file.mimeType,
          extension,
          ...(input.folderId && { folder_id: input.folderId }), // Only include folder if it's defined
          is_public: true,
          metadata: input.metadata || {},
        });
        
        // Associate with albums if provided
        if (input.albumIds && input.albumIds.length > 0) {
          for (const albumId of input.albumIds) {
            await service.createAlbumMedias({
              album_id: albumId,
              media_id: mediaFile.id,
              sort_order: 0,
            });
          }
        }
        
        return mediaFile;
      })
    );
    
    return new StepResponse(mediaFiles, mediaFiles.map(f => f.id));
  },
  async (mediaFileIds: string[], { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    await service.softDeleteMediaFiles(mediaFileIds);
    
    // Clean up album associations
    for (const mediaId of mediaFileIds) {
      const albumMedias = await service.listAlbumMedias({
        media: mediaId,
      });
      for (const albumMedia of albumMedias) {
        await service.softDeleteAlbumMedias(albumMedia.id);
      }
    }
  }
);

// Helper function to determine file type from MIME type
function getFileTypeFromMimeType(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.includes("pdf") || mimeType.includes("document")) return "document";
  if (mimeType.includes("zip") || mimeType.includes("archive")) return "archive";
  return "other";
}

// Main composite workflow input
export type UploadAndOrganizeMediaInput = {
  files: {
    filename: string;
    mimeType: string;
    content: Buffer;
  }[];
  folder?: {
    name: string;
    description?: string;
    parent_folder_id?: string;
  };
  album?: {
    name: string;
    description?: string;
    type?: "gallery" | "portfolio" | "product" | "profile" | "general";
  };
  existingFolderId?: string;
  existingAlbumIds?: string[];
  metadata?: Record<string, any>;
};

// Main composite workflow
export const uploadAndOrganizeMediaWorkflow = createWorkflow(
  "upload-and-organize-media",
  (input: UploadAndOrganizeMediaInput) => {
    
    // Validate existing folder if existingFolderId is provided
    const existingFolder = when({ input }, ({ input }) => !!input.existingFolderId)
      .then(() => validateExistingFolderStep(input.existingFolderId!));
    
    // Create folder if new folder is specified
    const folder = when({ input }, ({ input }) => !!input.folder)
      .then(() => createFolderStep({
        ...input.folder!,
        parent_folder_id: input.folder?.parent_folder_id
      }));
    
    // Create album if new album is specified
    const album = when({ input }, ({ input }) => !!input.album)
      .then(() => createAlbumStep(input.album!));
    
    // Upload files using Medusa's core workflow
    const uploadedFiles = uploadFilesStep({
      files: input.files,
    });
    
    // Create media records and associations
    // Compute IDs at execution time using transform
    const computedFolderId = transform(
      { input, folder },
      (data) => data.input.existingFolderId || (data.folder ? data.folder.id : undefined)
    );

    const computedAlbumIds = transform(
      { input, album },
      (data) => data.input.existingAlbumIds || (data.album ? [data.album.id] : undefined)
    );

    const mediaFiles = createMediaRecordsStep({
      uploadedFiles,
      folderId: computedFolderId,
      albumIds: computedAlbumIds,
      metadata: input.metadata,
    });
    
    return new WorkflowResponse({
      folder,
      album,
      mediaFiles,
      uploadedFileCount: uploadedFiles.length,
    });
  }
);
