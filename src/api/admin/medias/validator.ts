import { z } from "zod";

// Validator for creating folder
export const folderSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
  description: z.string().optional(),
  parent_folder_id: z.string().optional(),
  is_public: z.boolean().optional(),
});

// Validator for creating album
const albumSchema = z.object({
  name: z.string().min(1, "Album name is required"),
  description: z.string().optional(),
  type: z
    .enum(["gallery", "portfolio", "product", "profile", "general"])
    .optional(),
});

// Validator for uploading and organizing media
export const uploadMediaSchema = z.object({
  // Folder options - either create new or use existing
  folder: folderSchema.optional(),
  existingFolderId: z.string().optional(),
  
  // Album options - either create new or use existing
  album: albumSchema.optional(),
  existingAlbumIds: z.array(z.string()).optional(),
  
  // Additional metadata
  metadata: z.record(z.any()).optional(),
});

// Type definitions
export type UploadMediaRequest = z.infer<typeof uploadMediaSchema>;
export type FolderRequest = z.infer<typeof folderSchema>;
export type AlbumRequest = z.infer<typeof albumSchema>;
