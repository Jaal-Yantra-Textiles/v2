// src/workflows/delete-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Link } from "@medusajs/framework/modules-sdk";
import PersonService from "../modules/person/service";
import { PERSON_MODULE } from "../modules/person";
import { InferTypeOf } from "@medusajs/framework/types";
import Person from "../modules/person/models/person";
import { console } from "inspector";
export type Person = InferTypeOf<typeof Person>;

type DeletePersonStepInput = {
  id: string;
};

export const deletePersonStep = createStep(
  "delete-person-step",
  async (input: DeletePersonStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const person = await personService.retrievePerson(input.id);
    const deleted = await personService.softDeletePeople({
      id: input.id
    })
    console.log(deleted)
    return new StepResponse(deleted, person);
  },
  async (person, { container }) => {
    // Only create the person if it's defined
    if (person) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
      
      // Extract only the base properties that createPeople expects
      // This excludes relationship properties like addresses, contact_details, etc.
      const {
        id,
        first_name,
        last_name,
        email,
        date_of_birth,
        metadata,
        avatar,
        state
      } = person;
      
      // Pass only the expected properties to createPeople
      await personService.createPeople({
        id,
        first_name,
        last_name,
        email,
        date_of_birth,
        metadata,
        avatar,
        state
      });
    }
  },
);

/**
 * Dismiss the links a deleted person still sits in.
 *
 * 🔴 SOFT DELETE IS THE DANGEROUS ONE, because it is the ordinary one.
 *
 * `softDeletePeople` sets `deleted_at` and leaves every link row live. That is
 * not a cosmetic leftover: soft-deleted records are excluded from query results
 * unless `withDeleted: true` is passed, so `query.graph` answers with a NULL in
 * the person's place while the link row goes on asserting that somebody is
 * there. A reader that maps over that list and reads `.id` off the null takes
 * its whole page down — measured on the partner detail page, which died
 * outright rather than losing a section (#1857).
 *
 * Demonstrated end to end before this step existed: link a person to a partner,
 * DELETE /admin/persons/:id, and GET /admin/partners/:id/people came back with
 * a null in the list and a count of one. One ordinary deletion was enough.
 *
 * `Link.delete` is the cascade form — it soft-deletes every link row pointing at
 * these persons across every module, so this does not need to know which
 * modules link to a person. Its inverse, `Link.restore`, is the compensation:
 * the step above puts the person back, and a restored person with its links
 * still dismissed would be a quieter version of the same lie.
 */
const dismissPersonLinksStep = createStep(
  "dismiss-person-links-step",
  async (input: DeletePersonStepInput, { container }) => {
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK);
    await link.delete({ [PERSON_MODULE]: { person_id: input.id } });
    return new StepResponse({ person_id: input.id }, { person_id: input.id });
  },
  async (undo: { person_id: string } | undefined, { container }) => {
    if (!undo?.person_id) return;
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK);
    await link
      .restore({ [PERSON_MODULE]: { person_id: undo.person_id } })
      .catch(() => {});
  },
);

const deletePersonWorkflow = createWorkflow(
  "delete-person",
  (input: DeletePersonStepInput) => {
    const deleted = deletePersonStep(input);
    /*
     * After the person, not before: a failure here compensates by restoring the
     * links AND recreating the person, whereas dismissing first would leave a
     * window where the roster is short and the person is still there.
     */
    dismissPersonLinksStep(input);
    return new WorkflowResponse(deleted);
  },
);

export default deletePersonWorkflow;
