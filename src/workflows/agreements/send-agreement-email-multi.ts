import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk";
import {
  fetchAgreementDataStep,
  updateAgreementStatsStep,
} from "./steps";
import { 
  createMultipleAgreementResponsesStep
} from "./steps/create-multiple-agreement-responses";
import { linkMultiplePersonsWithAgreementStep } from "./steps/link-multiple-persons-with-agreement";
import { sendMultipleAgreementEmailsStep } from "./steps/send-multiple-agreement-emails";
import { fetchMultiplePersonsDataStep } from "./steps/fetch-multiple-persons-data";

export type SendAgreementEmailMultiInput = {
  agreement_id: string;
  person_ids: string[]; // Required array of person IDs
  template_key?: string; // Optional: override agreement's template_key
};

export const sendAgreementEmailMultiWorkflow = createWorkflow(
  "send-agreement-email-multi",
  (input: SendAgreementEmailMultiInput) => {
    // Step 1: Fetch agreement data (using first person ID to get agreement info)
    const { agreement } = fetchAgreementDataStep({
      agreement_id: input.agreement_id,
      person_id: input.person_ids[0],
    });

    // Step 2: Fetch all persons' data for email sending
    const persons = fetchMultiplePersonsDataStep({
      person_ids: input.person_ids,
    });

    // Step 3: Create agreement response records for all signers
    const agreementResponses = createMultipleAgreementResponsesStep({
      agreement_id: input.agreement_id,
      signer_data: transform({ persons }, (data) => {
        return data.persons.map((person: any) => ({
          person_id: person.id,
          email_sent_to: person.email,
        }));
      }),
    });

    // Step 4: Create person-agreement module links for all signers
    const personAgreementLinks = linkMultiplePersonsWithAgreementStep({
      agreement_id: input.agreement_id,
      person_ids: input.person_ids,
    });

    // Step 5: Send emails to all signers
    const emailResults = sendMultipleAgreementEmailsStep({
      agreement: agreement,
      signers: transform({ persons, agreementResponses }, (data) => {
        return data.persons.map((person: any, index: number) => ({
          person: person,
          agreementResponse: data.agreementResponses[index],
        }));
      }),
      template_key: input.template_key,
    });

    // Step 6: Update agreement stats
    const statsUpdated = updateAgreementStatsStep({
      agreement_id: input.agreement_id,
    });

    return new WorkflowResponse({
      agreement_responses: agreementResponses,
      person_agreement_links: personAgreementLinks,
      email_results: emailResults,
      stats_updated: statsUpdated,
    });
  }
);
