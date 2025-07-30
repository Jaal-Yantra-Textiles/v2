import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { findWebsiteByDomainWorkflow } from "../../../../../workflows/website/find-website-by-domain";
import { z } from "zod";
import createPersonWorkflow from "../../../../../workflows/create-person";
import { SubscriptionSchema } from "../validators";
import createPersonTagsWorkflow from "../../../../../workflows/persons/create-person-tags";
import createPersonSubWorkflow, { SubscriptionStatus } from "../../../../../workflows/persons/create-person-subs";

export const POST = async (
  req: MedusaRequest<SubscriptionSchema>,
  res: MedusaResponse,
) => {
  const { domain } = req.params;
  
    const { email, first_name, last_name, subscription_type , network } = req.validatedBody;
    
    // First, find the website to ensure it exists and get its details
    const websiteResponse = await findWebsiteByDomainWorkflow(req.scope).run({
      input: {
        domain,
      },
    });
    
    if (websiteResponse.errors.length > 0) {
      throw websiteResponse.errors;
    }
    
    const website = websiteResponse.result;
    
    // Create a person with subscription metadata
    const {result, errors} = await createPersonWorkflow(req.scope).run({
      input: {
        first_name,
        last_name,
        email,
      },
    });

    // Then the subs relationship

    await createPersonSubWorkflow(req.scope).run({
      input: {
        person_id: result.id,
        subscription_type: subscription_type,
        network: network,
        subscription_status: SubscriptionStatus.ACTIVE,
        email_subscribed: email,
      },
    });

    
    
    if (errors.length > 0) {
      throw errors;
    }
  
    
    return res.status(200).json({
      message: "Subscription successful",
    });
  }
