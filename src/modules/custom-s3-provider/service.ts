import { MedusaService } from "@medusajs/framework/utils"
import LocalFileService from "./services/local-file"
import S3ListingService from "./services/s3-listing"
import { logger } from "@medusajs/framework"


export interface FileListingServiceInterface {
  listAllFiles(pagination: { limit: number; offset: number }): Promise<any>;
  // Add other common methods if any, e.g., upload, delete, etc.
}

class S3ListingServiceModule extends MedusaService({
  // You can define shared configurations or dependencies for the module here if needed
}) {
  protected fileListingService_: FileListingServiceInterface;
  protected logger_;

  constructor(container) { // Medusa services typically receive the container for DI
    super(container);
    this.logger_ = container.logger || logger; // Use injected logger or fallback

    if (process.env.NODE_ENV === 'production') {
      this.logger_.info("S3ListingServiceModule: Initializing S3ListingService for production environment.");
      this.fileListingService_ = new S3ListingService({ logger: this.logger_ });
    } else {
      this.logger_.info("S3ListingServiceModule: Initializing LocalFileService for development environment.");
      // Assuming LocalFileServiceOptions are not strictly needed or can be defaulted
      // If LocalFileService requires specific options, they should be passed here.
      this.fileListingService_ = new LocalFileService({ logger: this.logger_ }, {}); 
    }
  }

  async listAllFiles(pagination: { limit: number; offset: number }) {
    if (!this.fileListingService_) {
        this.logger_.error("File listing service not initialized correctly.");
        throw new Error("File listing service not initialized.");
    }
    this.logger_.info(`S3ListingServiceModule: Delegating listAllFiles call with pagination: limit=${pagination.limit}, offset=${pagination.offset}`);
    return this.fileListingService_.listAllFiles(pagination);
  }
}

export default S3ListingServiceModule