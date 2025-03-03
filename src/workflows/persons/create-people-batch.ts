import {
    createWorkflow,
    createStep,
    StepResponse,
    WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";

export type CreatePersonWorkFlowInput = {
    first_name: string;
    last_name: string;
    email: string;
    date_of_birth?: Date;
    metadata?: Record<string, any>;
};

const createPeopleBatchStep = createStep(
    "create-people-batch-step",
    async (input: CreatePersonWorkFlowInput[], { container }) => {
        const personService: PersonService = container.resolve(PERSON_MODULE);
        const people = await personService.createPeople(input);
        return new StepResponse(people);
    },
    async (people, { container }) => {
        const personService: PersonService = container.resolve(PERSON_MODULE);
        // Delete all created people in case of rollback
        for (const person of people!) {
            await personService.deletePeople(person.id);
        }
    }
);

const createPeopleBatchWorkflow = createWorkflow(
    {
        name: "create-people-batch",
        store: true
    },
    (input: CreatePersonWorkFlowInput[]) => {
        const people = createPeopleBatchStep(input);
        return new WorkflowResponse(people);
    }
);

export default createPeopleBatchWorkflow;
