import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createHook, createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { emitEventStep } from "@medusajs/medusa/core-flows";

export enum SubscriptionType {
  EMAIL = "email",
  SMS = "sms"
}

export enum Network {
  CICILABEL = "cicilabel",
  JAALYANTRA = "jaalyantra"
}

export enum SubscriptionStatus {
  ACTIVE = "active",
  INACTIVE = "inactive"
}

export type CreatePersonSubStepInput = {
  person_id: string;
  subscription_type: SubscriptionType;
  network: Network;
  subscription_status: SubscriptionStatus;
  email_subscribed: string;
};

export type CreatePersonSubWorkflowInput = {
  person_id: string;
  subscription_type: SubscriptionType;
  network: Network;
  subscription_status: SubscriptionStatus;
  email_subscribed: string;
};

export const createPersonSubStep = createStep(
  "create-person-sub-step",
  async (input: CreatePersonSubStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const personSub = await personService.createPersonSubs(input);
    return new StepResponse(personSub, personSub.id);
  },
  async (personSubId, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    if (personSubId) {
        await personService.deletePersonSubs(personSubId);
    }
  },
);

export const createPersonSubWorkflow = createWorkflow(
  "create-person-sub",
  (input: CreatePersonSubWorkflowInput) => {
    const result = createPersonSubStep(input);
    const personSubCreatedHook = createHook(
      "personSubCreated",
      { 
        personId: input.person_id
      }
    );
    emitEventStep({
        eventName: "subscription.created",
        data: {
            person_id: input.person_id
        }
    })
    return new WorkflowResponse(result, {
      hooks: [personSubCreatedHook],
    });
  },
);

export default createPersonSubWorkflow;