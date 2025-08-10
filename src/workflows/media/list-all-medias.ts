import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { listFolderWorkflow } from "./list-folder";
import { listAlbumWorkflow } from "./list-album";
import { listMediaFileWorkflow } from "./list-media-file";
import { listAlbumMediaWorkflow } from "./list-album-media";

export type ListAllMediasInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listAllMediasWorkflow = createWorkflow(
  "list-all-medias",
  (input: ListAllMediasInput) => {
    // Forward the same filters/config to each underlying workflow
    const foldersRes = listFolderWorkflow.runAsStep({
      input: transform({ input }, (data) => ({
        filters: data.input.filters || {},
        config: data.input.config,
      })),
    });

    const albumsRes = listAlbumWorkflow.runAsStep({
      input: transform({ input }, (data) => ({
        filters: data.input.filters || {},
        config: data.input.config,
      })),
    });

    const mediaFilesRes = listMediaFileWorkflow.runAsStep({
      input: transform({ input }, (data) => ({
        filters: data.input.filters || {},
        config: data.input.config,
      })),
    });

    const albumMediaRes = listAlbumMediaWorkflow.runAsStep({
      input: transform({ input }, (data) => ({
        filters: data.input.filters || {},
        config: data.input.config,
      })),
    });

    const result = transform(
      { foldersRes, albumsRes, mediaFilesRes, albumMediaRes },
      (data) => {
        const [folders = [], folders_count = 0] = (data.foldersRes as any) || [];
        const [albums = [], albums_count = 0] = (data.albumsRes as any) || [];
        const [media_files = [], media_files_count = 0] = (data.mediaFilesRes as any) || [];
        const [album_media = [], album_media_count = 0] = (data.albumMediaRes as any) || [];

        return {
          folders,
          folders_count,
          albums,
          albums_count,
          media_files,
          media_files_count,
          album_media,
          album_media_count,
        };
      }
    );

    return new WorkflowResponse(result);
  }
);
