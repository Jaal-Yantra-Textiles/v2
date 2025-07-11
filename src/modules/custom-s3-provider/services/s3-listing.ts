import { S3Client, ListObjectsV2Command, ListObjectsV2CommandOutput, _Object as S3ObjectType } from "@aws-sdk/client-s3";
import { MedusaError } from "@medusajs/framework/utils";
import { Logger } from "@medusajs/framework/types";


interface EditorFile {
  id: string;
  url: string;
}

interface S3ListingServiceDependencies {
  logger: Logger;
}

export class S3ListingService {
  static identifier = "s3ListingService";
  protected logger_: Logger;
  protected client_: S3Client;
  protected config_: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    fileUrl: string;
    endpoint?: string;
    prefix?: string;
  };

  constructor({ logger }: S3ListingServiceDependencies) {
    this.logger_ = logger;
    
    const bucket = process.env.S3_BUCKET!;
    let endpoint = process.env.S3_ENDPOINT;
    let fileUrl = process.env.S3_URL || process.env.S3_FILE_URL!;

    // To make configuration more robust, automatically strip the bucket name from the end of the
    // endpoint and fileUrl if it's present. This prevents a common misconfiguration.
    const bucketSuffix = `/${bucket}`;
    if (endpoint && endpoint.endsWith(bucketSuffix)) {
      endpoint = endpoint.slice(0, -bucketSuffix.length);
    }
    if (fileUrl && fileUrl.endsWith(bucketSuffix)) {
      fileUrl = fileUrl.slice(0, -bucketSuffix.length);
    }

    this.config_ = {
      bucket: bucket,
      region: process.env.S3_REGION!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      fileUrl: fileUrl,
      endpoint: endpoint,
      prefix: process.env.S3_PREFIX,
    };

    if (!this.config_.bucket || !this.config_.region || !this.config_.accessKeyId || !this.config_.secretAccessKey) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "S3ListingService: S3 credentials (bucket, region, keys) are required.");
    }
    
    this.client_ = new S3Client({
      region: this.config_.region,
      credentials: {
        accessKeyId: this.config_.accessKeyId,
        secretAccessKey: this.config_.secretAccessKey,
      },
      endpoint: this.config_.endpoint,
    });

    this.logger_.info("S3ListingService initialized");
  }

  async listAllFiles(pagination: {
    limit: number;
    offset: number;
  }): Promise<{ files: EditorFile[]; count: number; limit: number; offset: number }> {
    const { limit, offset } = pagination;
    const s3Client = this.client_;
    const bucket = this.config_.bucket;
    const rawPrefix = this.config_.prefix || "";
    // Sanitize the prefix: remove leading/trailing slashes, then add a single trailing slash if not empty.
    // This makes the prefix format from config/env vars more flexible.
    const sanitizedPrefix = rawPrefix.replace(/^\/+/, '').replace(/\/+$/, '');
    const prefix = sanitizedPrefix ? `${sanitizedPrefix}/` : '';

    let allS3Objects: S3ObjectType[] = [];
    let continuationToken: string | undefined = undefined;
    let isTruncated = true;

    this.logger_.info(`S3ListingService: Listing files from S3 bucket: ${bucket}, raw_prefix: '${rawPrefix}', effective_prefix: '${prefix}'`);

    while (isTruncated) {
      const commandInput: any = {
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      };

      if (prefix) {
        commandInput.Prefix = prefix;
      }

      const command = new ListObjectsV2Command(commandInput);
      try {
        const result: ListObjectsV2CommandOutput = await s3Client.send(command);
        if (result.Contents) {
          const filesOnly = result.Contents.filter(obj => !(obj.Key?.endsWith('/') && obj.Size === 0));
          allS3Objects.push(...filesOnly);
        }
        isTruncated = result.IsTruncated ?? false;
        continuationToken = result.NextContinuationToken;
        this.logger_.debug(`Fetched ${result.Contents?.length || 0} S3 objects. IsTruncated: ${isTruncated}`);
      } catch (error: any) {
        if (error.name === 'NoSuchKey') {
          this.logger_.warn(`S3 prefix '${prefix}' not found in bucket '${bucket}'. Returning empty list.`);
          isTruncated = false; // Stop the loop
          allS3Objects = []; // Ensure the list is empty
          break;
        } else {
          this.logger_.error(`Error listing S3 objects: ${error.message}`, error);
          throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Failed to list S3 objects: ${error.message}`);
        }
      }
    }

    const totalCount = allS3Objects.length;
    this.logger_.info(`Total S3 objects fetched (after filtering): ${totalCount}`);

    const paginatedS3Objects = allS3Objects.slice(offset, offset + limit);

    const editorFiles: EditorFile[] = paginatedS3Objects.map((s3Object) => {
      if (!s3Object.Key) {
        this.logger_.warn("S3 object encountered without a Key during mapping.");
        return { id: "error-s3-object-no-key", url: "" };
      }
      return {
        id: s3Object.Key,
        // Properly encode each path segment of the key to handle spaces and other special characters,
        // while preserving the path separators ('/').
        url: `${this.config_.fileUrl}/${s3Object.Key!.split('/').map(encodeURIComponent).join('/')}`,
      };
    }).filter(file => file.id !== "error-s3-object-no-key");

    return {
      files: editorFiles,
      count: totalCount,
      limit: limit,
      offset: offset,
    };
  }
}

export default S3ListingService;