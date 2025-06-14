import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MedusaError, Modules } from "@medusajs/utils";
import { S3ListingService } from "../../modules/custom-s3-provider/services/s3-listing";
import { S3_LISTING_MODULE } from "../../modules/custom-s3-provider";

interface EditorFile {
  id: string;
  url: string;
}

// Input for the entire workflow
export interface ListEditorFilesWorkflowInput {
  filters?: {}; // Filters are not supported by the underlying fileService.listAndCountFiles beyond 'id'
  pagination: {
    offset: number;
    limit: number;
  };
}

// Output of the step and the workflow
export interface ListEditorFilesWorkflowOutput {
  files: EditorFile[];
  count: number;
  offset: number;
  limit: number;
}

// Input specifically for the listFilesStep (derived from workflow input)
interface ListFilesStepInternalInput {
  filters?: {}; // Filters are not supported by the underlying fileService.listAndCountFiles beyond 'id'
  pagination: {
    offset: number;
    limit: number;
  };
}

interface ValidateAndPrepareInputStepOutput extends ListFilesStepInternalInput {}

export const validateAndPrepareInputStep = createStep(
  "validate-and-prepare-list-editor-files-input-step",
  async (input: ListEditorFilesWorkflowInput, { container }) => {
    const { filters, pagination } = input;

    if (pagination.limit < 1 || pagination.limit > 100) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Limit must be between 1 and 100."
      );
    }
    if (pagination.offset < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Offset must be a non-negative number."
      );
    }

    const stepInput: ValidateAndPrepareInputStepOutput = {
      filters: {},
      pagination: {
        offset: pagination.offset,
        limit: pagination.limit,
      },
    };

    return new StepResponse(stepInput, null);
  }
);

export const listFilesStep = createStep(
  "list-editor-files-step",
  async (input: ListFilesStepInternalInput, { container }) => {
    // Using FileRepository for direct DB access to list all files with pagination
    // Assuming 'File' is the entity name and 'fileRepository' is its registered name in the container.
    // The exact type for fileRepository might be EntityRepository<File> (MikroORM) or Repository<File> (TypeORM)
    // Resolve the custom listing service using its static identifier
    const listingService: S3ListingService = container.resolve(S3_LISTING_MODULE);
    // Use findAndCount for pagination and total count
    // The specific options (like orderBy) might vary slightly based on the ORM (TypeORM/MikroORM)
    if (!listingService || typeof listingService.listAllFiles !== 'function') {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "S3ListingService with listAllFiles method not resolved correctly.");
    }

    // Call the listAllFiles method
    const result = await listingService.listAllFiles({
      limit: input.pagination.limit,
      offset: input.pagination.offset,
    });

    // The result from listAllFiles should already match ListEditorFilesWorkflowOutput structure
    return new StepResponse(result as ListEditorFilesWorkflowOutput, null);
  }
);

export const listEditorFilesWorkflow = createWorkflow(
  {
    name: 'list-editor-files',
    // store: true, // Optional: enable if you need to store workflow execution history
  },
  (input: ListEditorFilesWorkflowInput): WorkflowResponse<ListEditorFilesWorkflowOutput> => {
    const preparedInput = validateAndPrepareInputStep(input);
    const result = listFilesStep(preparedInput);
    return new WorkflowResponse(result);
  }
);

export default listEditorFilesWorkflow;
