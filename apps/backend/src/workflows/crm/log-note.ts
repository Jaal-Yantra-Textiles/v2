import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { CRM_MODULE } from "../../modules/crm";

type LogNoteStepInput = {
  body: string;
  author?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  metadata?: Record<string, any>;
};

export const logNoteStep = createStep(
  "log-crm-note-step",
  async (input: LogNoteStepInput, { container }) => {
    const service: any = container.resolve(CRM_MODULE);
    const note = await service.createCrmNotes(input);
    return new StepResponse(note, note.id);
  },
  async (noteId, { container }) => {
    const service: any = container.resolve(CRM_MODULE);
    await service.deleteCrmNotes(noteId!);
  },
);

export type LogNoteWorkflowInput = LogNoteStepInput;

export const logNoteWorkflow = createWorkflow(
  "log-crm-note",
  (input: LogNoteWorkflowInput) => {
    const note = logNoteStep(input);
    return new WorkflowResponse(note);
  },
);

export default logNoteWorkflow;
