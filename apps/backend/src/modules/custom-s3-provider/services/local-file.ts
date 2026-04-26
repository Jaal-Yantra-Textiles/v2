import { LocalFileServiceOptions, Logger } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import fs from "fs/promises";
import path from "path";
import { FileListingServiceInterface } from "../service"; // Import the shared interface

interface EditorFile {
  id: string;
  url: string;
}

interface LocalFileServiceDependencies {
  logger: Logger;
}

export class LocalFileService implements FileListingServiceInterface {
  static identifier = "localfsListingOnly";
  protected uploadDir_: string;
  protected backendUrl_: string;
  protected logger_: Logger;

  constructor({ logger }: LocalFileServiceDependencies, options: LocalFileServiceOptions) {
    this.logger_ = logger;
    this.uploadDir_ = options?.upload_dir || path.join(process.cwd(), "static");
    this.backendUrl_ = options?.backend_url || "http://localhost:9000";
    this.logger_.info("LocalFileService (Listing Only) initialized");
  }

  async listAllFiles(pagination: {
    limit: number;
    offset: number;
  }): Promise<{ files: EditorFile[]; count: number; limit: number; offset: number }> {
    const { limit, offset } = pagination;
    this.logger_.info(`LocalFileService.listAllFiles: Scanning directory: ${this.uploadDir_} for listing.`);

    try {
      const getAllFiles = async (dirPath: string, arrayOfFiles: string[] = []) => {
        const files = await fs.readdir(dirPath, { withFileTypes: true });

        for (const file of files) {
          const fullPath = path.join(dirPath, file.name);
          if (file.isDirectory()) {
            await getAllFiles(fullPath, arrayOfFiles);
          } else {
            arrayOfFiles.push(path.relative(this.uploadDir_, fullPath));
          }
        }
        return arrayOfFiles;
      };

      const allFileKeys = await getAllFiles(this.uploadDir_);
      const totalCount = allFileKeys.length;

      this.logger_.info(`Total local files found: ${totalCount}`);

      const paginatedFileKeys = allFileKeys.slice(offset, offset + limit);

      const editorFiles: EditorFile[] = paginatedFileKeys.map((fileKey) => ({
        id: fileKey,
        url: this.getUploadFileUrl(fileKey),
      }));

      return {
        files: editorFiles,
        count: totalCount,
        limit,
        offset,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger_.warn(`Upload directory ${this.uploadDir_} not found. Returning empty list.`);
        return { files: [], count: 0, limit, offset };
      }
      this.logger_.error(`Error listing local files: ${error.message}`, error);
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Failed to list local files: ${error.message}`);
    }
  }

  protected getUploadFileUrl(fileKey: string): string {
    const cleanBackendUrl = this.backendUrl_.replace(/\/+$/, '');
    const cleanFileKey = fileKey.replace(/^\/+/, '');
    return `${cleanBackendUrl}/static/${cleanFileKey}`;
  }
}

export default LocalFileService;
