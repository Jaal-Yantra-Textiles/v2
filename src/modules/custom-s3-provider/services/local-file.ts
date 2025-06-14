import { FileTypes, LocalFileServiceOptions, Logger } from "@medusajs/framework/types"
import {
  AbstractFileProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import { createReadStream } from "fs"
import fs from "fs/promises"
import path from "path"
import type { Readable } from "stream"

interface EditorFile {
  id: string;
  url: string;
}

interface LocalFileServiceDependencies {
  logger: Logger;
}

export class LocalFileService extends AbstractFileProviderService {
  static identifier = "localfs"
  protected uploadDir_: string
  protected privateUploadDir_: string
  protected backendUrl_: string
  protected logger_: Logger;

  constructor({ logger }: LocalFileServiceDependencies, options: LocalFileServiceOptions) {
    super()
    this.logger_ = logger;
    this.uploadDir_ = options?.upload_dir || path.join(process.cwd(), "static")
    this.privateUploadDir_ = options?.private_upload_dir || path.join(process.cwd(), "static")
    this.backendUrl_ = options?.backend_url || "http://localhost:9000"
    this.logger_.info("LocalFileService initialized");
  }

  async listAllFiles(pagination: { // Added for debugging path
    limit: number;
    offset: number;
  }): Promise<{ files: EditorFile[]; count: number; limit: number; offset: number }> {
    const { limit, offset } = pagination;
    this.logger_.info(`LocalFileService.listAllFiles: Scanning directory: ${this.uploadDir_} for listing.`); // Enhanced log

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

  async upload(
    file: FileTypes.ProviderUploadFileDTO
  ): Promise<FileTypes.ProviderFileResultDTO> {
    if (!file) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `No file provided`)
    }

    if (!file.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `No filename provided`
      )
    }

    const parsedFilename = path.parse(file.filename);
    this.logger_.info(`LocalFileService.upload: Attempting to upload ${file.filename}. Access: ${file.access}`); // Log file access type
    const baseDir =
      file.access === "public" ? this.uploadDir_ : this.privateUploadDir_;
    this.logger_.info(`LocalFileService.upload: Determined baseDir for upload: ${baseDir}`); // Log baseDir
    await this.ensureDirExists(baseDir, parsedFilename.dir)

    const fileKey = path.join(
      parsedFilename.dir,
      `${file.access === "public" ? "" : "private-"}${Date.now()}-${
        parsedFilename.base
      }`
    )

    const filePath = this.getUploadFilePath(baseDir, fileKey);
    this.logger_.info(`LocalFileService.upload: Determined filePath for saving: ${filePath}`); // Log final filePath
    const fileUrl = this.getUploadFileUrl(fileKey)

    const content = Buffer.from(file.content as string, "binary")
    await fs.writeFile(filePath, content)

    return {
      key: fileKey,
      url: fileUrl,
    }
  }

  async delete(
    files: FileTypes.ProviderDeleteFileDTO | FileTypes.ProviderDeleteFileDTO[]
  ): Promise<void> {
    files = Array.isArray(files) ? files : [files]

    await Promise.all(
      files.map(async (file) => {
        const baseDir = file.fileKey.startsWith("private-")
          ? this.privateUploadDir_
          : this.uploadDir_

        const filePath = this.getUploadFilePath(baseDir, file.fileKey)
        try {
          await fs.access(filePath, fs.constants.W_OK)
          await fs.unlink(filePath)
        } catch (e: any) {
          if (e.code !== "ENOENT") {
            throw e
          }
        }
      })
    )

    return
  }

  async getDownloadStream(
    file: FileTypes.ProviderGetFileDTO
  ): Promise<Readable> {
    const baseDir = file.fileKey.startsWith("private-")
      ? this.privateUploadDir_
      : this.uploadDir_

    const filePath = this.getUploadFilePath(baseDir, file.fileKey)
    return createReadStream(filePath)
  }

  async getAsBuffer(file: FileTypes.ProviderGetFileDTO): Promise<Buffer> {
    const baseDir = file.fileKey.startsWith("private-")
      ? this.privateUploadDir_
      : this.uploadDir_

    const filePath = this.getUploadFilePath(baseDir, file.fileKey)
    return fs.readFile(filePath)
  }

  async getPresignedDownloadUrl(
    file: FileTypes.ProviderGetFileDTO
  ): Promise<string> {
    const isPrivate = file.fileKey.startsWith("private-")
    const baseDir = isPrivate ? this.privateUploadDir_ : this.uploadDir_

    const filePath = this.getUploadFilePath(baseDir, file.fileKey)

    try {
      await fs.access(filePath, fs.constants.F_OK)
    } catch {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `File with key ${file.fileKey} not found`
      )
    }

    return this.getUploadFileUrl(file.fileKey)
  }

  async getPresignedUploadUrl(
    fileData: FileTypes.ProviderGetPresignedUploadUrlDTO
  ): Promise<FileTypes.ProviderFileResultDTO> {
    if (!fileData?.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `No filename provided`
      )
    }

    return {
      url: "/admin/uploads",
      key: fileData.filename,
    }
  }

  private getUploadFilePath = (baseDir: string, fileKey: string) => {
    return path.join(baseDir, fileKey)
  }

  private getUploadFileUrl = (fileKey: string) => {
    const baseUrl = new URL(this.backendUrl_)
    baseUrl.pathname = path.join("/static", fileKey)
    return baseUrl.href
  }

  private async ensureDirExists(baseDir: string, dirPath: string) {
    const relativePath = path.join(baseDir, dirPath)
    try {
      await fs.access(relativePath, fs.constants.F_OK)
    } catch (e: any) {
      await fs.mkdir(relativePath, { recursive: true })
    }

    return relativePath
  }
}

export default LocalFileService;
