import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk";
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows";
import { MEDIA_MODULE } from "../../modules/media";
import MediaFileService from "../../modules/media/service";
import { Modules } from "@medusajs/framework/utils";

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
    const folder = await service.createFolders({
      ...input,
      slug,
      path: `/${slug}`,
      level: 0,
      sort_order: 0,
    });
    
    return new StepResponse(folder, folder.id);
  },
  async (folderId: string, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    await service.softDeleteFolders(folderId);
  }
);

// Step 2: Create album if needed
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
    content: Buffer;
  }[];
};

export const uploadFilesStep = createStep(
  "upload-files-step",
  async (input: UploadFilesStepInput, { container }) => {
    const { result } = await uploadFilesWorkflow.run({
      input: {
        files: input.files,
      },
    });
    
    // Transform the result to match expected format for createMediaRecordsStep
    const transformedFiles = result.map((file: any) => ({
      id: file.id,
      url: file.url,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
    }));
    
    return new StepResponse(transformedFiles, result);
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
        const extension = file.filename.split(".").pop() || "";
        const fileType = getFileTypeFromMimeType(file.mimeType);
        
        const mediaFile = await service.createMediaFiles({
          file_name: file.filename,
          original_name: file.filename,
          file_path: file.url,
          file_size: file.size,
          file_type: fileType as "image" | "video" | "audio" | "document" | "archive" | "other",
          mime_type: file.mimeType,
          extension,
          folder: input.folderId,
          is_public: true,
          metadata: input.metadata || {},
        });
        
        // Associate with albums if provided
        if (input.albumIds && input.albumIds.length > 0) {
          for (const albumId of input.albumIds) {
            await service.createAlbumMedias({
              album: albumId,
              media: mediaFile.id,
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
    
    // Create folder if new folder is specified
    const folder = when({ input }, ({ input }) => !!input.folder)
      .then(() => createFolderStep(input.folder!));
    
    // Create album if new album is specified
    const album = when({ input }, ({ input }) => !!input.album)
      .then(() => createAlbumStep(input.album!));
    
    // Upload files using Medusa's core workflow
    const uploadedFiles = uploadFilesStep({
      files: input.files,
    });
    
    // Create media records and associations
    const mediaFiles = createMediaRecordsStep({
      uploadedFiles,
      folderId: input.existingFolderId || folder?.id,
      albumIds: input.existingAlbumIds || (album?.id ? [album.id] : undefined),
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
